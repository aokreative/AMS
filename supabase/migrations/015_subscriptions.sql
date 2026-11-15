-- ============================================================
-- 015: Subscriptions
--   Agencies pay per month (Paystack, M-Pesa or card) for one of
--   four tiers. agencies.paid_until is the last paid day; 3 days of
--   grace; then the agency is read-only until the Owner pays.
--   Comped agencies (complimentary_until) are exempt from both the
--   read-only rule and the tier limits.
--
--   - subscription_tiers (authority for prices and limits)
--   - agencies.paid_until / complimentary_until / terms_accepted_at,
--     users.terms_accepted_at, tier CHECK widened (pro -> growth)
--   - subscription_payments (Paystack references; service-role writes)
--   - agency_access(agency) -> active | grace | read_only
--   - enforce_subscription(): one trigger on every agency-scoped table.
--     Applies to API users (JWT role 'authenticated'); fixture, cron and
--     service-role writes are not blocked. Trusted RPCs that must write
--     for a read-only agency set the transaction-local GUC
--     ams.system_write = 'on' (only create_agency_with_owner and
--     accept_invite; the test pins the allow-list).
--   - member limit in create_invite / accept_invite; policy limit in
--     the trigger (insert, or status change into active/pending)
--   - subscription_check_tier, subscription_usage
--   - create_subscription_payment / apply_subscription_payment for the
--     Edge Functions (service role only); idempotent on reference
--   - consent: p_terms_accepted on create_agency_with_owner / accept_invite
--   - pg_cron job 'subscription_reminders_daily' (created inactive)
--   - demo agency comped; any other existing agency gets 30 days
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 1. Tiers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_tiers (
  key                 TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  price_kes           INTEGER NOT NULL CHECK (price_kes > 0),
  max_members         INTEGER CHECK (max_members IS NULL OR max_members > 0),
  max_active_policies INTEGER CHECK (max_active_policies IS NULL OR max_active_policies > 0),
  sort_order          INTEGER NOT NULL
);

INSERT INTO subscription_tiers (key, name, price_kes, max_members, max_active_policies, sort_order) VALUES
  ('starter',         'Starter',         3500,  3,    300,  1),
  ('growth',          'Growth',          7000,  10,   NULL, 2),
  ('enterprise',      'Enterprise',      15000, 25,   NULL, 3),
  ('enterprise_plus', 'Enterprise Plus', 30000, NULL, NULL, 4)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, price_kes = EXCLUDED.price_kes, max_members = EXCLUDED.max_members,
      max_active_policies = EXCLUDED.max_active_policies, sort_order = EXCLUDED.sort_order;

ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_tiers_select ON subscription_tiers;
CREATE POLICY subscription_tiers_select ON subscription_tiers FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------
-- 2. Agency / user columns
-- ------------------------------------------------------------
ALTER TABLE agencies DROP CONSTRAINT IF EXISTS agencies_subscription_tier_check;
UPDATE agencies SET subscription_tier = 'growth' WHERE subscription_tier = 'pro';
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS paid_until          DATE,
  ADD COLUMN IF NOT EXISTS complimentary_until DATE,
  ADD COLUMN IF NOT EXISTS terms_accepted_at   TIMESTAMPTZ;
ALTER TABLE agencies
  ADD CONSTRAINT agencies_subscription_tier_fkey
  FOREIGN KEY (subscription_tier) REFERENCES subscription_tiers(key);
ALTER TABLE agencies ALTER COLUMN subscription_tier SET DEFAULT 'starter';
ALTER TABLE agencies ALTER COLUMN subscription_tier SET NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Existing agencies: demo comped for good, anyone else gets 30 days.
UPDATE agencies SET complimentary_until = DATE '2099-12-31'
 WHERE id = '00ca4ec4-7ca5-4f84-a9ef-ef8b6e3b006c';
UPDATE agencies SET complimentary_until = (now() AT TIME ZONE 'Africa/Nairobi')::date + 30
 WHERE complimentary_until IS NULL AND paid_until IS NULL;

-- ------------------------------------------------------------
-- 3. Payments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id          UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  tier               TEXT NOT NULL REFERENCES subscription_tiers(key),
  months             INTEGER NOT NULL CHECK (months IN (0, 1, 3, 6, 12)),
  amount_kes         INTEGER NOT NULL CHECK (amount_kes >= 0),
  paystack_reference TEXT NOT NULL UNIQUE,
  channel            TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  paid_until_before  DATE,
  paid_until_after   DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at            TIMESTAMPTZ,
  raw                JSONB
);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_agency ON subscription_payments(agency_id, created_at DESC);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payments_owner_select ON subscription_payments;
CREATE POLICY subscription_payments_owner_select ON subscription_payments FOR SELECT TO authenticated
  USING (agency_id = public.current_user_agency_id() AND public.current_user_role() = 'owner');
-- No INSERT/UPDATE/DELETE policies and no table privilege: only the
-- service role writes (a plain UPDATE must fail, not match zero rows).
REVOKE INSERT, UPDATE, DELETE ON subscription_payments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON subscription_tiers    FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. Access state
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agency_access(p_agency_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN a.complimentary_until IS NOT NULL AND a.complimentary_until >= today THEN 'active'
           WHEN a.paid_until IS NOT NULL AND a.paid_until >= today THEN 'active'
           WHEN a.paid_until IS NOT NULL AND a.paid_until + 3 >= today THEN 'grace'
           ELSE 'read_only'
         END
    FROM agencies a, (SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date AS today) t
   WHERE a.id = p_agency_id;
$$;
REVOKE EXECUTE ON FUNCTION public.agency_access(UUID) FROM PUBLIC, anon, authenticated;

-- True while the agency is comped: no tier limits apply.
CREATE OR REPLACE FUNCTION public._agency_is_comped(p_agency_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(a.complimentary_until >= (now() AT TIME ZONE 'Africa/Nairobi')::date, false)
    FROM agencies a WHERE a.id = p_agency_id;
$$;
REVOKE EXECUTE ON FUNCTION public._agency_is_comped(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Usage and tier checks
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._subscription_counts(p_agency_id UUID,
  OUT members INTEGER, OUT pending_invites INTEGER, OUT active_policies INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT count(*)::int FROM users WHERE agency_id = p_agency_id AND deactivated_at IS NULL),
         (SELECT count(*)::int FROM agency_invites
           WHERE agency_id = p_agency_id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()),
         (SELECT count(*)::int FROM policies WHERE agency_id = p_agency_id AND status IN ('active', 'pending'));
$$;
REVOKE EXECUTE ON FUNCTION public._subscription_counts(UUID) FROM PUBLIC, anon, authenticated;

-- Owner of the agency reads its usage.
CREATE OR REPLACE FUNCTION public.subscription_usage(p_agency_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF public.current_user_agency_id() IS DISTINCT FROM p_agency_id OR public.current_user_role() <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public._subscription_counts(p_agency_id);
  RETURN jsonb_build_object('members', c.members, 'pending_invites', c.pending_invites, 'active_policies', c.active_policies);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.subscription_usage(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.subscription_usage(UUID) TO authenticated;

-- Would the agency fit the tier right now? Raises when not. Callable by
-- the service role (Edge Function) and by the agency's Owner (dry run).
CREATE OR REPLACE FUNCTION public.subscription_check_tier(p_agency_id UUID, p_tier TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t subscription_tiers%ROWTYPE;
  c RECORD;
BEGIN
  IF auth.uid() IS NOT NULL
     AND (public.current_user_agency_id() IS DISTINCT FROM p_agency_id OR public.current_user_role() <> 'owner') THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM subscription_tiers WHERE key = p_tier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a plan';
  END IF;
  SELECT * INTO c FROM public._subscription_counts(p_agency_id);
  IF t.max_members IS NOT NULL AND c.members > t.max_members THEN
    RAISE EXCEPTION 'Remove % members first', c.members - t.max_members;
  END IF;
  IF t.max_active_policies IS NOT NULL AND c.active_policies > t.max_active_policies THEN
    RAISE EXCEPTION 'Reduce active policies to % first', t.max_active_policies;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.subscription_check_tier(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.subscription_check_tier(UUID, TEXT) TO authenticated, service_role;

-- Member-limit check shared by create_invite and accept_invite.
CREATE OR REPLACE FUNCTION public._assert_member_capacity(p_agency_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INTEGER;
  c RECORD;
BEGIN
  IF public._agency_is_comped(p_agency_id) THEN
    RETURN;
  END IF;
  SELECT t.max_members INTO v_max
    FROM agencies a JOIN subscription_tiers t ON t.key = a.subscription_tier
   WHERE a.id = p_agency_id;
  IF v_max IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO c FROM public._subscription_counts(p_agency_id);
  IF c.members + c.pending_invites >= v_max THEN
    RAISE EXCEPTION 'Your plan allows % team members. Upgrade to add more.', v_max
      USING ERRCODE = 'P0001', HINT = 'member_limit';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_member_capacity(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. Enforcement trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims  JSONB := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_agency  UUID;
  v_max     INTEGER;
  v_count   INTEGER;
  v_new_status TEXT;
  v_old_status TEXT;
BEGIN
  -- Only API users are subject to the subscription. Fixtures, cron and
  -- the service role (Edge Functions) carry no 'authenticated' claim.
  IF coalesce(v_claims->>'role', '') <> 'authenticated' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF current_setting('ams.system_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_agency := COALESCE((to_jsonb(NEW)->>'agency_id')::uuid, (to_jsonb(OLD)->>'agency_id')::uuid);
  IF v_agency IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public.agency_access(v_agency) = 'read_only' THEN
    RAISE EXCEPTION 'Subscription inactive: the agency is read-only until payment'
      USING ERRCODE = 'P0001', HINT = 'subscription_read_only';
  END IF;

  -- Policy limit: a new active/pending policy, or one becoming active/pending.
  -- (Field access goes through jsonb: NEW has no status column on most tables.)
  IF TG_TABLE_NAME = 'policies' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_status := to_jsonb(NEW)->>'status';
    v_old_status := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->>'status' END;
    IF v_new_status IN ('active', 'pending')
       AND (TG_OP = 'INSERT' OR v_old_status NOT IN ('active', 'pending'))
       AND NOT public._agency_is_comped(v_agency) THEN
      SELECT t.max_active_policies INTO v_max
        FROM agencies a JOIN subscription_tiers t ON t.key = a.subscription_tier
       WHERE a.id = v_agency;
      IF v_max IS NOT NULL THEN
        SELECT count(*) INTO v_count FROM policies
         WHERE agency_id = v_agency AND status IN ('active', 'pending')
           AND id <> (to_jsonb(NEW)->>'id')::uuid;
        IF v_count >= v_max THEN
          RAISE EXCEPTION 'Your plan allows % active policies. Upgrade to add more.', v_max
            USING ERRCODE = 'P0001', HINT = 'policy_limit';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_subscription() FROM PUBLIC, anon, authenticated;

-- Attach to every table with an agency_id column, except the ones that
-- must stay writable while read-only.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'agency_id'
       AND c.table_name NOT IN ('users', 'subscription_payments', 'reports')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_subscription ON public.%I', r.table_name);
    EXECUTE format('CREATE TRIGGER trg_enforce_subscription
                    BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription()', r.table_name);
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 7. Sign-up and invites: consent, member limit, system-write bypass
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_agency_with_owner(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_agency_with_owner(
  p_agency_name    TEXT,
  p_owner_name     TEXT,
  p_owner_phone    TEXT DEFAULT NULL,
  p_terms_accepted BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_email     TEXT;
  v_agency_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(p_terms_accepted, false) THEN
    RAISE EXCEPTION 'Accept the Terms and Privacy Notice to continue';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to an agency' USING ERRCODE = '23505';
  END IF;
  IF length(trim(coalesce(p_agency_name, ''))) < 2 OR length(trim(coalesce(p_owner_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Agency name and owner name are required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- The new agency has not paid yet (read-only); seeding is a system write.
  PERFORM set_config('ams.system_write', 'on', true);

  INSERT INTO agencies (name, email, terms_accepted_at)
  VALUES (trim(p_agency_name), v_email, now())
  RETURNING id INTO v_agency_id;

  INSERT INTO users (id, agency_id, role, full_name, phone, email, terms_accepted_at)
  VALUES (v_uid, v_agency_id, 'owner', trim(p_owner_name), p_owner_phone, v_email, now());

  PERFORM public.seed_default_product_lines(v_agency_id);

  PERFORM set_config('ams.system_write', 'off', true);

  RETURN jsonb_build_object('agency_id', v_agency_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_agency_with_owner(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_agency_with_owner(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_invite(p_email TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := public.current_user_role();
  v_agency UUID := public.current_user_agency_id();
  v_email  TEXT := lower(btrim(p_email));
  v_code   TEXT;
  v_id     UUID;
  v_exp    TIMESTAMPTZ;
BEGIN
  IF v_agency IS NULL
     OR NOT (   (v_role = 'owner'   AND p_role IN ('manager', 'agent'))
             OR (v_role = 'manager' AND p_role = 'agent')) THEN
    RAISE EXCEPTION 'You are not allowed to invite that role' USING ERRCODE = '42501';
  END IF;

  IF v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_agency::text || ':' || v_email, 0));

  IF EXISTS (
    SELECT 1
      FROM users u
      LEFT JOIN auth.users au ON au.id = u.id
     WHERE u.agency_id = v_agency
       AND (lower(btrim(u.email)) = v_email OR lower(btrim(au.email)) = v_email)
  ) THEN
    RAISE EXCEPTION 'That person is already a member of this agency';
  END IF;

  IF EXISTS (
    SELECT 1 FROM agency_invites
     WHERE agency_id = v_agency AND email = v_email
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'There is already a pending invite for this email';
  END IF;

  PERFORM public._assert_member_capacity(v_agency);

  v_code := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO agency_invites (agency_id, email, role, token_hash, invited_by)
  VALUES (v_agency, v_email, p_role,
          encode(extensions.digest(v_code, 'sha256'), 'hex'), auth.uid())
  RETURNING id, expires_at INTO v_id, v_exp;

  RETURN jsonb_build_object('invite_id', v_id, 'code', v_code, 'expires_at', v_exp);
END;
$$;

DROP FUNCTION IF EXISTS public.accept_invite(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.accept_invite(p_code TEXT, p_full_name TEXT, p_terms_accepted BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_code   TEXT := lower(p_code);
  v_name   TEXT := btrim(p_full_name);
  v_email  TEXT;
  v_invite agency_invites%ROWTYPE;
  v_max    INTEGER;
  c        RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(p_terms_accepted, false) THEN
    RAISE EXCEPTION 'Accept the Terms and Privacy Notice to continue';
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Enter your full name';
  END IF;
  IF v_code IS NULL OR v_code !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  SELECT * INTO v_invite
    FROM agency_invites
   WHERE token_hash = encode(extensions.digest(v_code, 'sha256'), 'hex')
   FOR UPDATE;

  IF NOT FOUND
     OR v_invite.accepted_at IS NOT NULL
     OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS DISTINCT FROM v_invite.email THEN
    RAISE EXCEPTION 'This invite is for a different email address';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to an agency';
  END IF;

  -- The tier may have changed since the invite: the new member must fit.
  -- (This invite is itself one of the pending ones, so compare members
  -- alone against the limit.)
  IF NOT public._agency_is_comped(v_invite.agency_id) THEN
    SELECT t.max_members INTO v_max
      FROM agencies a JOIN subscription_tiers t ON t.key = a.subscription_tier
     WHERE a.id = v_invite.agency_id;
    IF v_max IS NOT NULL THEN
      SELECT * INTO c FROM public._subscription_counts(v_invite.agency_id);
      IF c.members + 1 > v_max THEN
        RAISE EXCEPTION 'Your plan allows % team members. Upgrade to add more.', v_max
          USING ERRCODE = 'P0001', HINT = 'member_limit';
      END IF;
    END IF;
  END IF;

  -- Joining must work even while the agency is read-only.
  PERFORM set_config('ams.system_write', 'on', true);

  INSERT INTO users (id, agency_id, role, full_name, email, terms_accepted_at)
  VALUES (v_uid, v_invite.agency_id, v_invite.role, v_name, v_invite.email, now());

  UPDATE agency_invites
     SET accepted_at = now(), accepted_by = v_uid
   WHERE id = v_invite.id;

  PERFORM set_config('ams.system_write', 'off', true);

  RETURN jsonb_build_object('agency_id', v_invite.agency_id, 'role', v_invite.role);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.accept_invite(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_invite(TEXT, TEXT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 8. Payment RPCs (service role only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_subscription_payment(
  p_agency_id UUID, p_tier TEXT, p_months INTEGER, p_amount_kes INTEGER)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subscription_tiers WHERE key = p_tier) THEN
    RAISE EXCEPTION 'Pick a plan';
  END IF;
  IF p_months IS NULL OR p_months NOT IN (0, 1, 3, 6, 12) THEN
    RAISE EXCEPTION 'Pick how many months';
  END IF;
  INSERT INTO subscription_payments (id, agency_id, tier, months, amount_kes, paystack_reference)
  VALUES (v_id, p_agency_id, p_tier, p_months, p_amount_kes, v_id::text);
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_subscription_payment(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_subscription_payment(UUID, TEXT, INTEGER, INTEGER) TO service_role;

-- Idempotent: true when this call moved the agency, false when the
-- payment was already applied or the reference is unknown.
CREATE OR REPLACE FUNCTION public.apply_subscription_payment(p_reference TEXT, p_channel TEXT, p_raw JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay    subscription_payments%ROWTYPE;
  v_today  DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_before DATE;
  v_after  DATE;
BEGIN
  SELECT * INTO v_pay FROM subscription_payments WHERE paystack_reference = p_reference FOR UPDATE;
  IF NOT FOUND OR v_pay.status = 'paid' THEN
    RETURN false;
  END IF;

  SELECT paid_until INTO v_before FROM agencies WHERE id = v_pay.agency_id FOR UPDATE;

  IF v_pay.months = 0 THEN
    v_after := v_before;   -- upgrade only
  ELSE
    v_after := (greatest(coalesce(v_before, v_today), v_today) + make_interval(months => v_pay.months))::date;
  END IF;

  UPDATE agencies
     SET subscription_tier = v_pay.tier,
         paid_until = v_after
   WHERE id = v_pay.agency_id;

  UPDATE subscription_payments
     SET status = 'paid',
         channel = p_channel,
         raw = p_raw,
         paid_at = now(),
         paid_until_before = v_before,
         paid_until_after = v_after
   WHERE id = v_pay.id;

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_subscription_payment(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_subscription_payment(TEXT, TEXT, JSONB) TO service_role;

-- ------------------------------------------------------------
-- 9. Daily reminders (created inactive; switch on once REMINDER_FROM
--    and the Vault secret 'service_role_key' exist):
--    SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'subscription_reminders_daily'), active := true);
-- ------------------------------------------------------------
DO $$
DECLARE
  v_job BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription_reminders_daily') THEN
    PERFORM cron.unschedule('subscription_reminders_daily');
  END IF;
  v_job := cron.schedule(
    'subscription_reminders_daily',
    '0 3 * * *',   -- 06:00 Africa/Nairobi
    $job$
      SELECT net.http_post(
        url     := 'https://frzjhknbocuaduuduxkk.supabase.co/functions/v1/subscription-reminders',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
        body    := '{}'::jsonb)
    $job$);
  PERFORM cron.alter_job(job_id := v_job, active := false);
END;
$$;
