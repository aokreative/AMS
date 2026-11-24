-- ============================================================
-- 020a: leads review fixes
--   #1 convert_lead: an agent may only use a client assigned to the
--      lead's agent (as the policies insert rule requires).
--   #3 remove_member hands the removed member's leads to the chosen
--      member, like their clients and policies.
--   #6 clear messages for bad numbers/dates, NaN figures and a policy
--      number already in use.
--   Demo: a few sample leads, saved into the demo copy (only the two
--   lead tables are re-saved; the rest of the copy is untouched).
-- ============================================================

-- Parse helpers: NULL for anything that isn't a finite number / a date.
CREATE OR REPLACE FUNCTION public._num_or_null(p TEXT)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v NUMERIC;
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  v := p::numeric;
  IF v = 'NaN'::numeric OR v = 'Infinity'::numeric OR v = '-Infinity'::numeric THEN RETURN NULL; END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public._date_or_null(p TEXT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  RETURN p::date;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public._uuid_or_null(p TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  RETURN p::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END; $$;

REVOKE EXECUTE ON FUNCTION public._num_or_null(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._date_or_null(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._uuid_or_null(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_lead_contact(p_lead_id UUID, p_occurred_on DATE, p_channel TEXT, p_note TEXT,
                                                  p_premium NUMERIC, p_next_follow_up DATE)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads := public._lead_for_update(p_lead_id);
BEGIN
  IF v.stage IN ('paid', 'lost') THEN RAISE EXCEPTION 'This lead is closed. Reopen it first.'; END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('call', 'whatsapp', 'sms', 'email', 'visit') THEN
    RAISE EXCEPTION 'Pick how you contacted them';
  END IF;
  IF p_premium IS NOT NULL AND (p_premium = 'NaN'::numeric OR p_premium < 0 OR p_premium > 9999999999) THEN
    RAISE EXCEPTION 'Enter a figure of 0 or more';
  END IF;
  INSERT INTO lead_activities (agency_id, lead_id, kind, occurred_on, channel, premium, next_follow_up, note, created_by)
  VALUES (v.agency_id, v.id, 'contact', coalesce(p_occurred_on, (now() AT TIME ZONE 'Africa/Nairobi')::date),
          p_channel, p_premium, p_next_follow_up, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  UPDATE leads SET
    quoted_premium   = coalesce(p_premium, quoted_premium),
    next_follow_up   = coalesce(p_next_follow_up, next_follow_up),
    last_activity_at = now(), updated_at = now()
  WHERE id = v.id;
  IF v.stage = 'new' THEN
    UPDATE leads SET stage = 'contacted' WHERE id = v.id;
    PERFORM public._lead_log(v, 'stage', 'new', 'contacted', NULL);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.convert_lead(p_lead_id UUID, p JSONB)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v leads := public._lead_for_update(p_lead_id);
  v_client  UUID := public._uuid_or_null(p->>'client_id');
  v_ins     UUID := public._uuid_or_null(p->>'insurer_id');
  v_pl      UUID := public._uuid_or_null(p->>'product_line_id');
  v_premium NUMERIC := public._num_or_null(p->>'premium_amount');
  v_rate    NUMERIC := public._num_or_null(p->>'commission_rate');
  v_start   DATE := public._date_or_null(p->>'start_date');
  v_end     DATE := public._date_or_null(p->>'expiry_date');
  v_number  TEXT := btrim(coalesce(p->>'policy_number', ''));
  v_policy  UUID;
BEGIN
  IF v.policy_id IS NOT NULL THEN RAISE EXCEPTION 'Already converted'; END IF;
  IF v.stage <> 'paid' THEN RAISE EXCEPTION 'Lead is not paid yet'; END IF;
  IF v_ins IS NULL THEN RAISE EXCEPTION 'Pick an insurer'; END IF;
  IF v_pl IS NULL THEN RAISE EXCEPTION 'Pick a product line'; END IF;
  PERFORM public._lead_check_refs(v_pl, v_ins);
  IF v_number = '' THEN RAISE EXCEPTION 'Enter the policy number'; END IF;
  IF v_premium IS NULL OR v_premium <= 0 OR v_premium > 9999999999 THEN RAISE EXCEPTION 'Enter the premium'; END IF;
  IF v_rate IS NULL OR v_rate NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Enter a commission rate between 0 and 100';
  END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
    RAISE EXCEPTION 'Enter start and expiry dates (expiry after start)';
  END IF;
  IF EXISTS (SELECT 1 FROM policies WHERE agency_id = v.agency_id AND lower(policy_number) = lower(v_number)
               AND status IN ('active', 'pending')) THEN
    RAISE EXCEPTION 'That policy number is already used';
  END IF;

  IF v_client IS NOT NULL THEN
    -- Agents may only use a client of the lead's agent; owners/managers any client of the agency.
    IF NOT EXISTS (SELECT 1 FROM clients WHERE id = v_client AND agency_id = v.agency_id
                     AND (public.is_owner_or_manager() OR assigned_agent_id = v.assigned_agent_id)) THEN
      RAISE EXCEPTION 'Pick a client';
    END IF;
  ELSE
    INSERT INTO clients (agency_id, type, name, phone, email, assigned_agent_id)
    VALUES (v.agency_id, CASE WHEN p->>'client_type' = 'corporate' THEN 'corporate' ELSE 'individual' END,
            v.full_name, v.phone, v.email, v.assigned_agent_id)
    RETURNING id INTO v_client;
  END IF;

  INSERT INTO policies (agency_id, client_id, insurer_id, product_line_id, agent_id, policy_number,
                        premium_amount, commission_rate, commission_basis, start_date, expiry_date, status)
  VALUES (v.agency_id, v_client, v_ins, v_pl, v.assigned_agent_id, v_number,
          v_premium, v_rate, 'annual', v_start, v_end, 'pending')
  RETURNING id INTO v_policy;

  UPDATE leads SET client_id = v_client, policy_id = v_policy, updated_at = now() WHERE id = v.id;
  PERFORM public._lead_log(v, 'converted', NULL, NULL, v_number);
  RETURN v_policy;
END; $$;

-- #3: remove_member (016a) + leads step
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
  v_leads    INTEGER;
BEGIN
  IF v_agency IS NULL OR v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('owners:' || v_agency::text, 0));

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND agency_id = v_agency
                   AND role = 'owner' AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
    FROM users
   WHERE id = p_user_id AND agency_id = v_agency
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;
  IF v_target.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;
  IF v_target.role = 'owner'
     AND NOT EXISTS (SELECT 1 FROM users
                      WHERE agency_id = v_agency AND role = 'owner' AND deactivated_at IS NULL
                        AND id <> v_target.id) THEN
    RAISE EXCEPTION 'The last owner cannot be changed or removed' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM users
   WHERE id = p_reassign_to AND id <> v_target.id
     AND agency_id = v_agency AND deactivated_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick an active member of this agency' USING ERRCODE = '22023';
  END IF;

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

  UPDATE policies
     SET agent_id = p_reassign_to,
         updated_at = now()
   WHERE agency_id = v_agency
     AND agent_id = v_target.id
     AND status IN ('active', 'pending');
  GET DIAGNOSTICS v_swept = ROW_COUNT;
  v_policies := v_policies + v_swept;

  -- Leads go to the same person (open and closed, so history stays reachable).
  INSERT INTO lead_activities (agency_id, lead_id, kind, note, created_by)
  SELECT v_agency, id, 'assigned', (SELECT full_name FROM users WHERE id = p_reassign_to), auth.uid()
    FROM leads WHERE agency_id = v_agency AND assigned_agent_id = v_target.id AND stage NOT IN ('paid', 'lost');
  UPDATE leads SET assigned_agent_id = p_reassign_to, updated_at = now()
   WHERE agency_id = v_agency AND assigned_agent_id = v_target.id;
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  UPDATE agency_invites
     SET revoked_at = now()
   WHERE agency_id = v_agency
     AND invited_by = v_target.id
     AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_invites = ROW_COUNT;

  DELETE FROM agent_rates WHERE agency_id = v_agency AND user_id = v_target.id;

  UPDATE users SET deactivated_at = now() WHERE id = v_target.id;

  PERFORM set_config('ams.system_write', 'off', true);

  RETURN jsonb_build_object(
    'clients_moved',   v_clients,
    'policies_moved',  v_policies,
    'leads_moved',     v_leads,
    'invites_revoked', v_invites);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_member(UUID, UUID) TO authenticated;

-- Demo: sample leads across the pipeline, then save only the lead tables into the demo copy.
DO $$
DECLARE
  demo  UUID := '00ca4ec4-7ca5-4f84-a9ef-ef8b6e3b006c';
  agent UUID;
  owner UUID;
  pl    UUID;
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  l     UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agencies WHERE id = demo AND is_demo) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM leads WHERE agency_id = demo) THEN RETURN; END IF;
  SELECT id INTO agent FROM users WHERE agency_id = demo AND role = 'agent' AND deactivated_at IS NULL
    AND id NOT IN (SELECT user_id FROM platform_admins) ORDER BY created_at LIMIT 1;
  SELECT id INTO owner FROM users WHERE agency_id = demo AND role = 'owner' AND deactivated_at IS NULL
    AND id NOT IN (SELECT user_id FROM platform_admins) ORDER BY created_at LIMIT 1;
  agent := coalesce(agent, owner);
  SELECT id INTO pl FROM product_lines WHERE agency_id = demo ORDER BY name LIMIT 1;
  IF owner IS NULL THEN RETURN; END IF;

  INSERT INTO leads (agency_id, full_name, phone, interest, product_line_id, source, stage, assigned_agent_id, created_by, last_activity_at, created_at)
  VALUES (demo, 'Grace Achieng', '0722 410 337', 'Medical cover for a family of four', pl, 'referral', 'new', agent, owner, now(), now() - interval '1 day')
  RETURNING id INTO l;

  INSERT INTO leads (agency_id, full_name, phone, interest, product_line_id, source, stage, quoted_premium, next_follow_up, assigned_agent_id, created_by, last_activity_at, created_at)
  VALUES (demo, 'Brian Mwangi', '0711 902 145', 'Comprehensive cover, Toyota Fielder 2016', pl, 'walk_in', 'contacted', 38500, today, agent, owner, now(), now() - interval '4 days')
  RETURNING id INTO l;
  INSERT INTO lead_activities (agency_id, lead_id, kind, occurred_on, channel, premium, next_follow_up, note, created_by) VALUES
    (demo, l, 'contact', today - 3, 'call', NULL, today - 1, 'Asked for comprehensive cover; sending options.', agent),
    (demo, l, 'contact', today - 1, 'whatsapp', 38500, today, 'Shared two quotes; prefers the cheaper one.', agent);

  INSERT INTO leads (agency_id, full_name, phone, interest, product_line_id, source, stage, quoted_premium, next_follow_up, assigned_agent_id, created_by, last_activity_at, created_at)
  VALUES (demo, 'Kilimo Fresh Ltd', '0733 118 650', 'Group life for 24 staff', pl, 'referral', 'quoted', 412000, today - 2, agent, owner, now(), now() - interval '12 days')
  RETURNING id INTO l;
  INSERT INTO lead_activities (agency_id, lead_id, kind, occurred_on, channel, premium, next_follow_up, note, created_by) VALUES
    (demo, l, 'contact', today - 10, 'visit', NULL, today - 7, 'Met the HR manager; needs a group scheme.', agent),
    (demo, l, 'contact', today - 6, 'email', 412000, today - 2, 'Sent the formal quote.', agent);

  INSERT INTO leads (agency_id, full_name, phone, interest, product_line_id, source, stage, quoted_premium, assigned_agent_id, created_by, last_activity_at, created_at)
  VALUES (demo, 'Fatuma Hassan', '0700 554 210', 'Third party only, boda boda', pl, 'social', 'won', 6200, agent, owner, now(), now() - interval '6 days');

  INSERT INTO leads (agency_id, full_name, phone, interest, product_line_id, source, stage, lost_reason, previous_stage, quoted_premium, closed_at, assigned_agent_id, created_by, last_activity_at, created_at)
  VALUES (demo, 'Samuel Otieno', '0791 330 812', 'Home contents cover', pl, 'phone', 'lost', 'price', 'quoted', 21000, now() - interval '2 days', agent, owner, now(), now() - interval '15 days');

  DROP TABLE IF EXISTS demo_snapshot.leads;
  DROP TABLE IF EXISTS demo_snapshot.lead_activities;
  EXECUTE format('CREATE TABLE demo_snapshot.leads AS SELECT * FROM public.leads WHERE agency_id = %L', demo);
  EXECUTE format('CREATE TABLE demo_snapshot.lead_activities AS SELECT * FROM public.lead_activities WHERE agency_id = %L', demo);
END $$;
