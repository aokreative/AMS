-- ============================================================
-- 018: superadmin
--   * platform_admins: admin-only accounts (added by SQL, no UI)
--   * agencies.suspended_at / suspended_reason / custom_price_kes
--   * admin_actions: log of every superadmin change
--   * admin_* RPCs, all gated by is_platform_admin()
--   * suspension blocks every write (trigger) and payments (Edge Function)
-- Spec: docs/superpowers/specs/2026-11-18-superadmin-design.md
-- ============================================================

-- 1. Tables and columns ---------------------------------------
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admins FROM anon, authenticated;

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS custom_price_kes INTEGER CHECK (custom_price_kes > 0);

CREATE TABLE IF NOT EXISTS admin_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  admin_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  before     JSONB,
  after      JSONB,
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_agency_idx ON admin_actions (agency_id, created_at DESC);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_actions FROM anon, authenticated;

-- 2. Who is a superadmin ----------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public._assert_platform_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a superadmin can do that' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_platform_admin() FROM PUBLIC, anon, authenticated;

-- 3. Suspension in access and the write trigger ---------------
CREATE OR REPLACE FUNCTION public.agency_access(p_agency_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN a.suspended_at IS NOT NULL THEN 'suspended'
           WHEN a.complimentary_until IS NOT NULL AND a.complimentary_until >= today THEN 'active'
           WHEN a.paid_until IS NOT NULL AND a.paid_until >= today THEN 'active'
           WHEN a.paid_until IS NOT NULL AND a.paid_until + 3 >= today THEN 'grace'
           ELSE 'read_only'
         END
    FROM agencies a, (SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date AS today) t
   WHERE a.id = p_agency_id;
$$;
REVOKE EXECUTE ON FUNCTION public.agency_access(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims  JSONB := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_agency  UUID;
  v_access  TEXT;
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

  v_agency := COALESCE((to_jsonb(NEW)->>'agency_id')::uuid, (to_jsonb(OLD)->>'agency_id')::uuid);
  IF v_agency IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_access := public.agency_access(v_agency);

  -- A suspended agency can't change anything, not even through the
  -- system-write paths (member removal, invite revoke).
  IF v_access = 'suspended' THEN
    RAISE EXCEPTION 'This account is suspended'
      USING ERRCODE = 'P0001', HINT = 'account_suspended';
  END IF;

  IF current_setting('ams.system_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'policies' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_status := to_jsonb(NEW)->>'status';
    v_old_status := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->>'status' END;
  END IF;

  IF v_access = 'read_only' THEN
    -- Reducing usage is allowed while unpaid: cancelling or expiring
    -- a live policy, with no other change.
    IF TG_TABLE_NAME = 'policies' AND TG_OP = 'UPDATE'
       AND v_old_status IN ('active', 'pending')
       AND v_new_status IN ('cancelled', 'expired')
       -- commission_expected is a generated column (NULL in NEW here)
       AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'commission_expected')
         = (to_jsonb(OLD) - 'status' - 'updated_at' - 'commission_expected') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Subscription inactive: the agency is read-only until payment'
      USING ERRCODE = 'P0001', HINT = 'subscription_read_only';
  END IF;

  -- Policy limit: a new active/pending policy, or one becoming active/pending.
  IF TG_TABLE_NAME = 'policies' AND TG_OP IN ('INSERT', 'UPDATE')
     AND v_new_status IN ('active', 'pending')
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

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4. Reading -------------------------------------------------------
-- One row per agency with everything the admin list needs.
CREATE OR REPLACE FUNCTION public._admin_rows()
RETURNS SETOF JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date AS today)
  SELECT jsonb_build_object(
           'id', a.id,
           'name', a.name,
           'status', CASE
                       WHEN a.suspended_at IS NOT NULL THEN 'suspended'
                       WHEN a.complimentary_until IS NOT NULL AND a.complimentary_until >= t.today THEN 'comped'
                       WHEN a.paid_until IS NOT NULL AND a.paid_until >= t.today THEN 'active'
                       WHEN a.paid_until IS NOT NULL AND a.paid_until + 3 >= t.today THEN 'grace'
                       ELSE 'unpaid'
                     END,
           'tier', a.subscription_tier,
           'price_kes', coalesce(a.custom_price_kes, st.price_kes),
           'custom_price_kes', a.custom_price_kes,
           'paid_until', a.paid_until,
           'complimentary_until', a.complimentary_until,
           'suspended_at', a.suspended_at,
           'suspended_reason', a.suspended_reason,
           'currency', a.currency,
           'created_at', a.created_at,
           'members', (SELECT count(*) FROM users u WHERE u.agency_id = a.id AND u.deactivated_at IS NULL),
           'active_policies', (SELECT count(*) FROM policies p WHERE p.agency_id = a.id AND p.status IN ('active', 'pending')),
           'owners', coalesce((SELECT jsonb_agg(jsonb_build_object('full_name', u.full_name, 'email', u.email, 'phone', u.phone) ORDER BY u.created_at)
                                 FROM users u WHERE u.agency_id = a.id AND u.role = 'owner' AND u.deactivated_at IS NULL), '[]'::jsonb),
           'last_paid_at', lp.paid_at,
           'last_paid_kes', lp.amount_kes
         )
    FROM agencies a
    CROSS JOIN t
    LEFT JOIN subscription_tiers st ON st.key = a.subscription_tier
    LEFT JOIN LATERAL (
      SELECT sp.paid_at, sp.amount_kes FROM subscription_payments sp
       WHERE sp.agency_id = a.id AND sp.status = 'paid'
       ORDER BY sp.paid_at DESC NULLS LAST LIMIT 1
    ) lp ON true
   ORDER BY a.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public._admin_rows() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_agencies()
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY SELECT * FROM public._admin_rows();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start TIMESTAMPTZ := date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi';
  v JSONB;
BEGIN
  PERFORM public._assert_platform_admin();
  SELECT jsonb_build_object(
           'counts', jsonb_build_object(
             'total', count(*),
             'active', count(*) FILTER (WHERE r->>'status' = 'active'),
             'grace', count(*) FILTER (WHERE r->>'status' = 'grace'),
             'unpaid', count(*) FILTER (WHERE r->>'status' = 'unpaid'),
             'comped', count(*) FILTER (WHERE r->>'status' = 'comped'),
             'suspended', count(*) FILTER (WHERE r->>'status' = 'suspended')),
           'expected_mrr_kes', coalesce(sum((r->>'price_kes')::int) FILTER (WHERE r->>'status' IN ('active', 'grace')), 0),
           'revenue_this_month_kes', (SELECT coalesce(sum(amount_kes), 0) FROM subscription_payments
                                       WHERE status = 'paid' AND paid_at >= v_month_start))
    INTO v
    FROM public._admin_rows() r;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_agency_detail(p_agency_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN jsonb_build_object(
    'payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', sp.id, 'tier', sp.tier, 'months', sp.months, 'amount_kes', sp.amount_kes,
               'status', sp.status, 'channel', sp.channel, 'created_at', sp.created_at, 'paid_at', sp.paid_at,
               'paid_until_after', sp.paid_until_after) ORDER BY sp.created_at DESC)
        FROM subscription_payments sp WHERE sp.agency_id = p_agency_id), '[]'::jsonb),
    'actions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'action', aa.action, 'before', aa.before, 'after', aa.after, 'note', aa.note,
               'created_at', aa.created_at, 'admin_email', au.email) ORDER BY aa.created_at DESC, aa.id)
        FROM admin_actions aa LEFT JOIN auth.users au ON au.id = aa.admin_id
       WHERE aa.agency_id = p_agency_id), '[]'::jsonb));
END;
$$;

-- 5. Changing ------------------------------------------------------
-- Checks the caller, the note and the agency; returns the agency's
-- subscription columns before the change (locked for update).
CREATE OR REPLACE FUNCTION public._admin_begin(p_agency_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  PERFORM public._assert_platform_admin();
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'Add a note';
  END IF;
  SELECT jsonb_build_object(
           'subscription_tier', subscription_tier, 'paid_until', paid_until,
           'complimentary_until', complimentary_until, 'custom_price_kes', custom_price_kes,
           'suspended_at', suspended_at, 'suspended_reason', suspended_reason)
    INTO v FROM agencies WHERE id = p_agency_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'Agency not found';
  END IF;
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._admin_begin(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._admin_log(p_agency_id UUID, p_action TEXT, p_before JSONB, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_actions (agency_id, admin_id, action, before, after, note)
  SELECT p_agency_id, auth.uid(), p_action, p_before,
         jsonb_build_object(
           'subscription_tier', subscription_tier, 'paid_until', paid_until,
           'complimentary_until', complimentary_until, 'custom_price_kes', custom_price_kes,
           'suspended_at', suspended_at, 'suspended_reason', suspended_reason),
         btrim(p_note)
    FROM agencies WHERE id = p_agency_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._admin_log(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_suspend(p_agency_id UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before JSONB := public._admin_begin(p_agency_id, p_note);
BEGIN
  IF v_before->>'suspended_at' IS NOT NULL THEN RAISE EXCEPTION 'Already suspended'; END IF;
  UPDATE agencies SET suspended_at = now(), suspended_reason = btrim(p_note) WHERE id = p_agency_id;
  PERFORM public._admin_log(p_agency_id, 'suspend', v_before, p_note);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reactivate(p_agency_id UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before JSONB := public._admin_begin(p_agency_id, p_note);
BEGIN
  IF v_before->>'suspended_at' IS NULL THEN RAISE EXCEPTION 'Not suspended'; END IF;
  UPDATE agencies SET suspended_at = NULL, suspended_reason = NULL WHERE id = p_agency_id;
  PERFORM public._admin_log(p_agency_id, 'reactivate', v_before, p_note);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_custom_price(p_agency_id UUID, p_price_kes INTEGER, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before JSONB := public._admin_begin(p_agency_id, p_note);
BEGIN
  IF p_price_kes IS NOT NULL AND p_price_kes <= 0 THEN RAISE EXCEPTION 'Enter a price above 0'; END IF;
  UPDATE agencies SET custom_price_kes = p_price_kes WHERE id = p_agency_id;
  PERFORM public._admin_log(p_agency_id, 'set_custom_price', v_before, p_note);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_comp(p_agency_id UUID, p_until DATE, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before JSONB := public._admin_begin(p_agency_id, p_note);
BEGIN
  IF p_until IS NOT NULL AND p_until < (now() AT TIME ZONE 'Africa/Nairobi')::date THEN
    RAISE EXCEPTION 'Pick today or a later date';
  END IF;
  UPDATE agencies SET complimentary_until = p_until WHERE id = p_agency_id;
  PERFORM public._admin_log(p_agency_id, 'set_comp', v_before, p_note);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_paid_until(p_agency_id UUID, p_until DATE, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before JSONB := public._admin_begin(p_agency_id, p_note);
BEGIN
  IF p_until IS NULL THEN RAISE EXCEPTION 'Pick a date'; END IF;
  UPDATE agencies SET paid_until = p_until WHERE id = p_agency_id;
  PERFORM public._admin_log(p_agency_id, 'set_paid_until', v_before, p_note);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_tier(p_agency_id UUID, p_tier TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before JSONB := public._admin_begin(p_agency_id, p_note);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subscription_tiers WHERE key = p_tier) THEN RAISE EXCEPTION 'Pick a plan'; END IF;
  UPDATE agencies SET subscription_tier = p_tier WHERE id = p_agency_id;
  PERFORM public._admin_log(p_agency_id, 'set_tier', v_before, p_note);
END; $$;

-- 6. Grants -------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_list_agencies()',
    'public.admin_overview()',
    'public.admin_agency_detail(uuid)',
    'public.admin_suspend(uuid, text)',
    'public.admin_reactivate(uuid, text)',
    'public.admin_set_custom_price(uuid, integer, text)',
    'public.admin_set_comp(uuid, date, text)',
    'public.admin_set_paid_until(uuid, date, text)',
    'public.admin_set_tier(uuid, text, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
