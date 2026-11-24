-- ============================================================
-- 020: leads pipeline
--   new → contacted → quoted → won → paid, lost from any open stage.
--   Contacts (channel, note, premium discussed, next follow-up) and
--   stage moves are logged in lead_activities. A paid lead converts to
--   a client + pending policy. Agents work their own leads; owners and
--   managers see all, reassign and delete. Writes only through RPCs.
-- Spec: docs/superpowers/specs/2026-11-24-leads-and-redesign-design.md
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL CHECK (btrim(full_name) <> ''),
  phone             TEXT,
  email             TEXT,
  interest          TEXT,
  product_line_id   UUID REFERENCES product_lines(id) ON DELETE SET NULL,
  insurer_id        UUID REFERENCES insurers(id) ON DELETE SET NULL,
  source            TEXT CHECK (source IN ('referral', 'walk_in', 'phone', 'whatsapp', 'social', 'website', 'other')),
  stage             TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'contacted', 'quoted', 'won', 'paid', 'lost')),
  previous_stage    TEXT CHECK (previous_stage IN ('new', 'contacted', 'quoted', 'won')),
  quoted_premium    NUMERIC(12,2) CHECK (quoted_premium >= 0),
  next_follow_up    DATE,
  lost_reason       TEXT CHECK (lost_reason IN ('price', 'went_elsewhere', 'no_response', 'not_eligible', 'other')),
  assigned_agent_id UUID NOT NULL REFERENCES users(id),
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  policy_id         UUID REFERENCES policies(id) ON DELETE SET NULL,
  notes             TEXT,
  closed_at         TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_agency_stage_idx ON leads (agency_id, stage);
CREATE INDEX IF NOT EXISTS leads_agent_idx ON leads (assigned_agent_id);

CREATE TABLE IF NOT EXISTS lead_activities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id      UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  lead_id        UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('contact', 'stage', 'lost', 'reopened', 'converted', 'assigned')),
  occurred_on    DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Nairobi')::date,
  channel        TEXT CHECK (channel IN ('call', 'whatsapp', 'sms', 'email', 'visit')),
  premium        NUMERIC(12,2),
  next_follow_up DATE,
  from_stage     TEXT,
  to_stage       TEXT,
  note           TEXT,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_activities_lead_idx ON lead_activities (lead_id, created_at DESC);

-- Read access: agents their own leads, owners/managers the whole agency.
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_select ON leads;
CREATE POLICY leads_select ON leads FOR SELECT TO authenticated
  USING (agency_id = public.current_user_agency_id()
         AND (public.is_owner_or_manager() OR assigned_agent_id = auth.uid()));
DROP POLICY IF EXISTS lead_activities_select ON lead_activities;
CREATE POLICY lead_activities_select ON lead_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_activities.lead_id));
REVOKE ALL ON leads, lead_activities FROM anon, authenticated;
GRANT SELECT ON leads, lead_activities TO authenticated;

-- Unpaid / suspended agencies can't write; the demo reset steps over the trigger.
DROP TRIGGER IF EXISTS trg_enforce_subscription ON leads;
CREATE TRIGGER trg_enforce_subscription BEFORE INSERT OR UPDATE OR DELETE ON leads
  FOR EACH ROW WHEN (current_setting('ams.demo_restore', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION enforce_subscription();
DROP TRIGGER IF EXISTS trg_enforce_subscription ON lead_activities;
CREATE TRIGGER trg_enforce_subscription BEFORE INSERT OR UPDATE OR DELETE ON lead_activities
  FOR EACH ROW WHEN (current_setting('ams.demo_restore', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION enforce_subscription();

CREATE OR REPLACE VIEW lead_pipeline WITH (security_invoker = true) AS
  SELECT stage, count(*)::int AS count, coalesce(sum(quoted_premium), 0)::numeric(14,2) AS quoted_total
    FROM leads GROUP BY stage;
REVOKE ALL ON lead_pipeline FROM anon, authenticated;
GRANT SELECT ON lead_pipeline TO authenticated;

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._lead_stage_rank(p_stage TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stage WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'quoted' THEN 3
                      WHEN 'won' THEN 4 WHEN 'paid' THEN 5 ELSE NULL END;
$$;

-- The caller's lead, locked; agents only reach their own.
CREATE OR REPLACE FUNCTION public._lead_for_update(p_lead_id UUID)
RETURNS leads LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads;
BEGIN
  SELECT * INTO v FROM leads
   WHERE id = p_lead_id AND agency_id = public.current_user_agency_id()
   FOR UPDATE;
  IF NOT FOUND OR (NOT public.is_owner_or_manager() AND v.assigned_agent_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public._lead_log(p_lead leads, p_kind TEXT, p_from TEXT, p_to TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO lead_activities (agency_id, lead_id, kind, from_stage, to_stage, note, created_by)
  VALUES (p_lead.agency_id, p_lead.id, p_kind, p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  UPDATE leads SET last_activity_at = now(), updated_at = now() WHERE id = p_lead.id;
END; $$;

CREATE OR REPLACE FUNCTION public._lead_assert_member(p_user UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user AND agency_id = public.current_user_agency_id()
                   AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Pick a member of your agency';
  END IF;
END; $$;

-- Optional product line / insurer must belong to the caller's agency.
CREATE OR REPLACE FUNCTION public._lead_check_refs(p_product_line UUID, p_insurer UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_product_line IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM product_lines WHERE id = p_product_line AND agency_id = public.current_user_agency_id()) THEN
    RAISE EXCEPTION 'Pick a product line';
  END IF;
  IF p_insurer IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM insurers WHERE id = p_insurer AND agency_id = public.current_user_agency_id()) THEN
    RAISE EXCEPTION 'Pick an insurer';
  END IF;
END; $$;

-- ------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_lead(p JSONB)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agency UUID := public.current_user_agency_id();
  v_agent  UUID := auth.uid();
  v_id     UUID;
  v_pl     UUID := nullif(p->>'product_line_id', '')::uuid;
  v_ins    UUID := nullif(p->>'insurer_id', '')::uuid;
BEGIN
  IF v_agency IS NULL THEN RAISE EXCEPTION 'Only agency members can do that' USING ERRCODE = '42501'; END IF;
  IF btrim(coalesce(p->>'full_name', '')) = '' THEN RAISE EXCEPTION 'Enter the lead''s name'; END IF;
  IF public.is_owner_or_manager() AND nullif(p->>'assigned_agent_id', '') IS NOT NULL THEN
    v_agent := (p->>'assigned_agent_id')::uuid;
    PERFORM public._lead_assert_member(v_agent);
  END IF;
  PERFORM public._lead_check_refs(v_pl, v_ins);
  INSERT INTO leads (agency_id, full_name, phone, email, interest, product_line_id, insurer_id, source,
                     assigned_agent_id, notes, created_by, last_activity_at)
  VALUES (v_agency, btrim(p->>'full_name'), nullif(btrim(coalesce(p->>'phone', '')), ''),
          nullif(btrim(coalesce(p->>'email', '')), ''), nullif(btrim(coalesce(p->>'interest', '')), ''),
          v_pl, v_ins, nullif(p->>'source', ''), v_agent, nullif(btrim(coalesce(p->>'notes', '')), ''),
          auth.uid(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_lead(p_lead_id UUID, p JSONB)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v leads := public._lead_for_update(p_lead_id);
  v_pl  UUID := CASE WHEN p ? 'product_line_id' THEN nullif(p->>'product_line_id', '')::uuid ELSE v.product_line_id END;
  v_ins UUID := CASE WHEN p ? 'insurer_id' THEN nullif(p->>'insurer_id', '')::uuid ELSE v.insurer_id END;
BEGIN
  IF p ? 'full_name' AND btrim(coalesce(p->>'full_name', '')) = '' THEN RAISE EXCEPTION 'Enter the lead''s name'; END IF;
  PERFORM public._lead_check_refs(v_pl, v_ins);
  UPDATE leads SET
    full_name = CASE WHEN p ? 'full_name' THEN btrim(p->>'full_name') ELSE full_name END,
    phone     = CASE WHEN p ? 'phone' THEN nullif(btrim(coalesce(p->>'phone', '')), '') ELSE phone END,
    email     = CASE WHEN p ? 'email' THEN nullif(btrim(coalesce(p->>'email', '')), '') ELSE email END,
    interest  = CASE WHEN p ? 'interest' THEN nullif(btrim(coalesce(p->>'interest', '')), '') ELSE interest END,
    source    = CASE WHEN p ? 'source' THEN nullif(p->>'source', '') ELSE source END,
    notes     = CASE WHEN p ? 'notes' THEN nullif(btrim(coalesce(p->>'notes', '')), '') ELSE notes END,
    product_line_id = v_pl,
    insurer_id = v_ins,
    updated_at = now()
  WHERE id = v.id;
END; $$;

CREATE OR REPLACE FUNCTION public.log_lead_contact(p_lead_id UUID, p_occurred_on DATE, p_channel TEXT, p_note TEXT,
                                                  p_premium NUMERIC, p_next_follow_up DATE)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads := public._lead_for_update(p_lead_id);
BEGIN
  IF v.stage IN ('paid', 'lost') THEN RAISE EXCEPTION 'This lead is closed. Reopen it first.'; END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('call', 'whatsapp', 'sms', 'email', 'visit') THEN
    RAISE EXCEPTION 'Pick how you contacted them';
  END IF;
  IF p_premium IS NOT NULL AND p_premium < 0 THEN RAISE EXCEPTION 'Enter a figure of 0 or more'; END IF;
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

CREATE OR REPLACE FUNCTION public.move_lead(p_lead_id UUID, p_to TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads := public._lead_for_update(p_lead_id);
BEGIN
  IF p_to IS NULL OR p_to NOT IN ('contacted', 'quoted', 'won', 'paid') THEN RAISE EXCEPTION 'Pick a stage'; END IF;
  IF v.stage IN ('paid', 'lost') THEN RAISE EXCEPTION 'This lead is closed. Reopen it first.'; END IF;
  IF public._lead_stage_rank(p_to) <= public._lead_stage_rank(v.stage) THEN
    RAISE EXCEPTION 'That stage is behind the current one';
  END IF;
  UPDATE leads SET stage = p_to,
                   previous_stage = CASE WHEN p_to = 'paid' THEN v.stage ELSE previous_stage END,
                   closed_at = CASE WHEN p_to = 'paid' THEN now() ELSE NULL END,
                   updated_at = now()
   WHERE id = v.id;
  PERFORM public._lead_log(v, 'stage', v.stage, p_to, NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.mark_lead_lost(p_lead_id UUID, p_reason TEXT, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads := public._lead_for_update(p_lead_id);
BEGIN
  IF v.stage IN ('paid', 'lost') THEN RAISE EXCEPTION 'This lead is closed. Reopen it first.'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('price', 'went_elsewhere', 'no_response', 'not_eligible', 'other') THEN
    RAISE EXCEPTION 'Pick a reason';
  END IF;
  UPDATE leads SET stage = 'lost', previous_stage = v.stage, lost_reason = p_reason,
                   closed_at = now(), updated_at = now()
   WHERE id = v.id;
  PERFORM public._lead_log(v, 'lost', v.stage, 'lost', coalesce(p_reason, '') || CASE WHEN nullif(btrim(coalesce(p_note, '')), '') IS NULL THEN '' ELSE ': ' || btrim(p_note) END);
END; $$;

CREATE OR REPLACE FUNCTION public.reopen_lead(p_lead_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads := public._lead_for_update(p_lead_id);
BEGIN
  IF v.stage NOT IN ('paid', 'lost') THEN RAISE EXCEPTION 'This lead is still open'; END IF;
  IF v.policy_id IS NOT NULL THEN RAISE EXCEPTION 'Already converted'; END IF;
  UPDATE leads SET stage = coalesce(previous_stage, 'new'), previous_stage = NULL, lost_reason = NULL,
                   closed_at = NULL, updated_at = now()
   WHERE id = v.id;
  PERFORM public._lead_log(v, 'reopened', v.stage, coalesce(v.previous_stage, 'new'), NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.assign_lead(p_lead_id UUID, p_agent_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads;
BEGIN
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can do that' USING ERRCODE = '42501'; END IF;
  v := public._lead_for_update(p_lead_id);
  PERFORM public._lead_assert_member(p_agent_id);
  UPDATE leads SET assigned_agent_id = p_agent_id, updated_at = now() WHERE id = v.id;
  PERFORM public._lead_log(v, 'assigned', NULL, NULL, (SELECT full_name FROM users WHERE id = p_agent_id));
END; $$;

CREATE OR REPLACE FUNCTION public.delete_lead(p_lead_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads;
BEGIN
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can do that' USING ERRCODE = '42501'; END IF;
  v := public._lead_for_update(p_lead_id);
  DELETE FROM leads WHERE id = v.id;
END; $$;

-- A paid lead becomes a client (new, or an existing one) and a pending policy.
CREATE OR REPLACE FUNCTION public.convert_lead(p_lead_id UUID, p JSONB)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v leads := public._lead_for_update(p_lead_id);
  v_client UUID := nullif(p->>'client_id', '')::uuid;
  v_ins UUID := nullif(p->>'insurer_id', '')::uuid;
  v_pl  UUID := nullif(p->>'product_line_id', '')::uuid;
  v_policy UUID;
BEGIN
  IF v.policy_id IS NOT NULL THEN RAISE EXCEPTION 'Already converted'; END IF;
  IF v.stage <> 'paid' THEN RAISE EXCEPTION 'Lead is not paid yet'; END IF;
  IF v_ins IS NULL THEN RAISE EXCEPTION 'Pick an insurer'; END IF;
  IF v_pl IS NULL THEN RAISE EXCEPTION 'Pick a product line'; END IF;
  PERFORM public._lead_check_refs(v_pl, v_ins);
  IF btrim(coalesce(p->>'policy_number', '')) = '' THEN RAISE EXCEPTION 'Enter the policy number'; END IF;
  IF coalesce((p->>'premium_amount')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Enter the premium'; END IF;
  IF (p->>'commission_rate') IS NULL OR (p->>'commission_rate')::numeric NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Enter a commission rate between 0 and 100';
  END IF;
  IF nullif(p->>'start_date', '') IS NULL OR nullif(p->>'expiry_date', '') IS NULL
     OR (p->>'expiry_date')::date <= (p->>'start_date')::date THEN
    RAISE EXCEPTION 'Enter start and expiry dates (expiry after start)';
  END IF;

  IF v_client IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM clients WHERE id = v_client AND agency_id = v.agency_id) THEN
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
  VALUES (v.agency_id, v_client, v_ins, v_pl, v.assigned_agent_id, btrim(p->>'policy_number'),
          (p->>'premium_amount')::numeric, (p->>'commission_rate')::numeric, 'annual',
          (p->>'start_date')::date, (p->>'expiry_date')::date, 'pending')
  RETURNING id INTO v_policy;

  UPDATE leads SET client_id = v_client, policy_id = v_policy, updated_at = now() WHERE id = v.id;
  PERFORM public._lead_log(v, 'converted', NULL, NULL, btrim(p->>'policy_number'));
  RETURN v_policy;
END; $$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._lead_stage_rank(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._lead_for_update(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._lead_log(leads, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._lead_assert_member(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._lead_check_refs(UUID, UUID) FROM PUBLIC, anon, authenticated;
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_lead(jsonb)',
    'public.update_lead(uuid, jsonb)',
    'public.log_lead_contact(uuid, date, text, text, numeric, date)',
    'public.move_lead(uuid, text)',
    'public.mark_lead_lost(uuid, text, text)',
    'public.reopen_lead(uuid)',
    'public.assign_lead(uuid, uuid)',
    'public.delete_lead(uuid)',
    'public.convert_lead(uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- The demo reset now covers leads.
SELECT public._demo_save_snapshot();
