-- ============================================================
-- 015a: subscription review fixes
--   #1 Owners could UPDATE agencies.paid_until / complimentary_until /
--      subscription_tier directly (table-level UPDATE grant + owner
--      RLS policy). Only profile columns stay client-writable.
--   #2 A payment priced against an older plan state (e.g. an
--      upgrade-only checkout left open while another payment landed)
--      is no longer applied automatically: it is marked needs_review
--      and the agency is left unchanged.
--   #4 A read-only agency can still reduce usage so it can move to a
--      cheaper plan: cancel/expire a policy, remove a member, revoke
--      an invite.
-- ============================================================

-- #1 ----------------------------------------------------------
REVOKE UPDATE ON agencies FROM authenticated, anon;
GRANT  UPDATE (name, email, phone, address, logo_url, primary_color) ON agencies TO authenticated;

-- #2 ----------------------------------------------------------
ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS base_tier       TEXT,
  ADD COLUMN IF NOT EXISTS base_paid_until DATE;
ALTER TABLE subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_status_check;
ALTER TABLE subscription_payments
  ADD CONSTRAINT subscription_payments_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'needs_review'));

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
  -- Snapshot the plan the amount was priced against.
  INSERT INTO subscription_payments (id, agency_id, tier, months, amount_kes, paystack_reference, base_tier, base_paid_until)
  SELECT v_id, p_agency_id, p_tier, p_months, p_amount_kes, v_id::text, a.subscription_tier, a.paid_until
    FROM agencies a WHERE a.id = p_agency_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_subscription_payment(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_subscription_payment(UUID, TEXT, INTEGER, INTEGER) TO service_role;

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
  v_tier   TEXT;
  v_before DATE;
  v_after  DATE;
BEGIN
  SELECT * INTO v_pay FROM subscription_payments WHERE paystack_reference = p_reference FOR UPDATE;
  IF NOT FOUND OR v_pay.status IN ('paid', 'needs_review') THEN
    RETURN false;
  END IF;

  SELECT subscription_tier, paid_until INTO v_tier, v_before FROM agencies WHERE id = v_pay.agency_id FOR UPDATE;

  -- The plan changed since this payment was priced: hold it for a person.
  IF v_tier IS DISTINCT FROM v_pay.base_tier OR v_before IS DISTINCT FROM v_pay.base_paid_until THEN
    UPDATE subscription_payments
       SET status = 'needs_review', channel = p_channel, raw = p_raw, paid_at = now()
     WHERE id = v_pay.id;
    RETURN false;
  END IF;

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

-- #4 ----------------------------------------------------------
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

  IF TG_TABLE_NAME = 'policies' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_status := to_jsonb(NEW)->>'status';
    v_old_status := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->>'status' END;
  END IF;

  IF public.agency_access(v_agency) = 'read_only' THEN
    -- Reducing usage is allowed while read-only: cancelling or expiring
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
REVOKE EXECUTE ON FUNCTION public.enforce_subscription() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.remove_member(p_user_id UUID, p_reassign_to UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     TEXT := public.current_user_role();
  v_agency   UUID := public.current_user_agency_id();
  v_target   users%ROWTYPE;
  v_client   UUID;
  v_clients  INTEGER := 0;
  v_policies INTEGER := 0;
  v_swept    INTEGER;
  v_invites  INTEGER;
BEGIN
  IF v_agency IS NULL OR v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
    FROM users
   WHERE id = p_user_id AND agency_id = v_agency
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;
  IF v_target.role = 'owner' THEN
    RAISE EXCEPTION 'The owner cannot be changed or removed' USING ERRCODE = '42501';
  END IF;
  IF v_target.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;

  -- The new assignee: an active member of the agency, not the one being removed
  PERFORM 1 FROM users
   WHERE id = p_reassign_to AND id <> v_target.id
     AND agency_id = v_agency AND deactivated_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;

  -- Removing a member reduces usage, so it must work while read-only.
  PERFORM set_config('ams.system_write', 'on', true);

  FOR v_client IN
    SELECT id FROM clients
     WHERE agency_id = v_agency AND assigned_agent_id = v_target.id
     ORDER BY id
     FOR UPDATE
  LOOP
    v_policies := v_policies + public._reassign_client_unchecked(v_client, p_reassign_to);
    v_clients  := v_clients + 1;
  END LOOP;

  -- Sweep the member's remaining live policies on clients assigned to
  -- someone else (owners/managers may set any agent_id). Expired and
  -- cancelled policies stay with the removed member.
  -- (Applied live as 008a_remove_member_sweeps_policies.)
  UPDATE policies
     SET agent_id = p_reassign_to,
         updated_at = now()
   WHERE agency_id = v_agency
     AND agent_id = v_target.id
     AND status IN ('active', 'pending');
  GET DIAGNOSTICS v_swept = ROW_COUNT;
  v_policies := v_policies + v_swept;

  UPDATE agency_invites
     SET revoked_at = now()
   WHERE agency_id = v_agency
     AND invited_by = v_target.id
     AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_invites = ROW_COUNT;

  -- A removed member earns nothing more (013a). Their earnings and
  -- payouts stay; the Owner can still set rates again if needed.
  DELETE FROM agent_rates WHERE agency_id = v_agency AND user_id = v_target.id;

  UPDATE users SET deactivated_at = now() WHERE id = v_target.id;

  PERFORM set_config('ams.system_write', 'off', true);

  RETURN jsonb_build_object(
    'clients_moved',   v_clients,
    'policies_moved',  v_policies,
    'invites_revoked', v_invites);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT := public.current_user_role();
  v_agency UUID := public.current_user_agency_id();
  v_invite agency_invites%ROWTYPE;
BEGIN
  IF v_agency IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'You are not allowed to revoke that invite' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite
    FROM agency_invites
   WHERE id = p_invite_id AND agency_id = v_agency
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  IF v_role = 'manager'
     AND (v_invite.role <> 'agent' OR v_invite.invited_by IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'You are not allowed to revoke that invite' USING ERRCODE = '42501';
  END IF;

  IF v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  -- Revoking reduces usage, so it must work while read-only.
  PERFORM set_config('ams.system_write', 'on', true);
  UPDATE agency_invites SET revoked_at = now() WHERE id = v_invite.id;
  PERFORM set_config('ams.system_write', 'off', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_invite(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_invite(UUID) TO authenticated;
