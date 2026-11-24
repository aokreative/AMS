-- ============================================================
-- Test 020: leads pipeline
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t020_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT; v_st TEXT; v_ran BOOLEAN := false;
BEGIN
  BEGIN EXECUTE p_sql; v_ran := true;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_st = RETURNED_SQLSTATE;
  END;
  ASSERT NOT v_ran, format('expected error %s %s, but it succeeded: %s', p_state, p_msg, p_sql);
  ASSERT (p_msg IS NULL OR v_msg = p_msg) AND (p_state IS NULL OR v_st = p_state),
    format('expected [%s] %s, got [%s] %s for: %s', p_state, p_msg, v_st, v_msg, p_sql);
END; $$;
GRANT EXECUTE ON FUNCTION public._t020_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t020_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t020_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag  UUID := gen_random_uuid();
  ag2 UUID := gen_random_uuid();   -- unpaid agency
  o   UUID := gen_random_uuid();   -- owner
  a1  UUID := gen_random_uuid();   -- agent 1
  a2  UUID := gen_random_uuid();   -- agent 2
  o2  UUID := gen_random_uuid();   -- owner of unpaid agency
  ins UUID; pl UUID;
  l1 UUID; l2 UUID; pol UUID; cl UUID;
  n INTEGER;
  r RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o,  'o-020@test.local',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a1, 'a1-020@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a2, 'a2-020@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (o2, 'o2-020@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until, setup_completed_at) VALUES
    (ag, 'Leads Agency 020', today + 30, now()),
    (ag2, 'Unpaid Agency 020', NULL, now());
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (o,  ag,  'owner', 'Owner 020',  'o-020@test.local'),
    (a1, ag,  'agent', 'Agent One',  'a1-020@test.local'),
    (a2, ag,  'agent', 'Agent Two',  'a2-020@test.local'),
    (o2, ag2, 'owner', 'Owner2 020', 'o2-020@test.local');
  INSERT INTO insurers (agency_id, name) VALUES (ag, 'Insurer 020') RETURNING id INTO ins;
  INSERT INTO product_lines (agency_id, name) VALUES (ag, 'Motor 020') RETURNING id INTO pl;

  BEGIN
    SET LOCAL ROLE authenticated;

    -- an agent creates a lead: assigned to themselves
    PERFORM _t020_as(a1);
    l1 := create_lead(jsonb_build_object('full_name', 'Mary Wanjiku', 'phone', '0712000020', 'interest', 'Motor – private car',
                                         'source', 'referral', 'assigned_agent_id', a2));
    ASSERT (SELECT (stage, assigned_agent_id) FROM leads WHERE id = l1) = ('new'::text, a1), 'agent lead is theirs, in new';
    PERFORM _t020_expect('SELECT create_lead(''{"full_name":"  "}''::jsonb)', 'Enter the lead''s name');

    -- another agent can't see or touch it
    PERFORM _t020_as(a2);
    SELECT count(*) INTO n FROM leads WHERE id = l1;
    ASSERT n = 0, 'agent 2 cannot see agent 1 lead';
    PERFORM _t020_expect(format('SELECT log_lead_contact(%L, current_date, %L, %L, NULL, NULL)', l1, 'call', 'x'), 'Lead not found');
    PERFORM _t020_expect(format('SELECT move_lead(%L, %L)', l1, 'quoted'), 'Lead not found');
    -- no direct writes
    PERFORM _t020_expect(format('UPDATE leads SET stage = %L WHERE id = %L', 'paid', l1), NULL, '42501');
    PERFORM _t020_expect(format('INSERT INTO leads (agency_id, full_name, assigned_agent_id) VALUES (%L, %L, %L)', ag, 'X', a2), NULL, '42501');

    -- first contact: new -> contacted; premium and follow-up recorded
    PERFORM _t020_as(a1);
    PERFORM log_lead_contact(l1, today, 'call', 'Wants comprehensive cover', 45000, today + 3);
    SELECT * INTO r FROM leads WHERE id = l1;
    ASSERT r.stage = 'contacted', 'first contact moves to contacted';
    ASSERT r.quoted_premium = 45000 AND r.next_follow_up = today + 3, 'premium and follow-up recorded';
    PERFORM log_lead_contact(l1, today, 'whatsapp', 'Sent quote', 42000, NULL);
    SELECT * INTO r FROM leads WHERE id = l1;
    ASSERT r.quoted_premium = 42000 AND r.next_follow_up = today + 3, 'latest premium wins, follow-up kept';
    PERFORM _t020_expect(format('SELECT log_lead_contact(%L, current_date, %L, NULL, NULL, NULL)', l1, 'pigeon'), 'Pick how you contacted them');

    -- forward moves only
    PERFORM move_lead(l1, 'quoted');
    PERFORM _t020_expect(format('SELECT move_lead(%L, %L)', l1, 'contacted'), 'That stage is behind the current one');
    PERFORM _t020_expect(format('SELECT move_lead(%L, %L)', l1, 'lost'), 'Pick a stage');
    PERFORM move_lead(l1, 'won');

    -- converting before paid is refused
    PERFORM _t020_expect(format('SELECT convert_lead(%L, %L::jsonb)', l1, '{}'), 'Lead is not paid yet');

    -- lost needs a reason; reopen returns to the previous stage
    l2 := create_lead(jsonb_build_object('full_name', 'John Otieno'));
    PERFORM move_lead(l2, 'contacted');
    PERFORM _t020_expect(format('SELECT mark_lead_lost(%L, NULL, NULL)', l2), 'Pick a reason');
    PERFORM mark_lead_lost(l2, 'price', 'Too expensive');
    ASSERT (SELECT (stage, lost_reason) FROM leads WHERE id = l2) = ('lost'::text, 'price'::text), 'lost with reason';
    PERFORM _t020_expect(format('SELECT move_lead(%L, %L)', l2, 'quoted'), 'This lead is closed. Reopen it first.');
    PERFORM reopen_lead(l2);
    ASSERT (SELECT (stage, lost_reason) FROM leads WHERE id = l2) = ('contacted'::text, NULL::text), 'reopened to contacted';

    -- assign / delete are for owners and managers
    PERFORM _t020_expect(format('SELECT assign_lead(%L, %L)', l2, a2), 'Only owners and managers can do that');
    PERFORM _t020_expect(format('SELECT delete_lead(%L)', l2), 'Only owners and managers can do that');
    PERFORM _t020_as(o);
    SELECT count(*) INTO n FROM leads WHERE agency_id = ag;
    ASSERT n = 2, 'owner sees all leads';
    PERFORM assign_lead(l2, a2);
    PERFORM _t020_as(a2);
    SELECT count(*) INTO n FROM leads WHERE id = l2;
    ASSERT n = 1, 'reassigned lead visible to agent 2';
    PERFORM _t020_as(o);
    PERFORM _t020_expect(format('SELECT assign_lead(%L, %L)', l2, o2), 'Pick a member of your agency');
    PERFORM delete_lead(l2);
    ASSERT NOT EXISTS (SELECT 1 FROM leads WHERE id = l2), 'deleted';

    -- paid -> convert to client + pending policy
    PERFORM _t020_as(a1);
    PERFORM move_lead(l1, 'paid');
    pol := convert_lead(l1, jsonb_build_object(
      'client_type', 'individual', 'insurer_id', ins, 'product_line_id', pl, 'policy_number', 'T020-0001',
      'premium_amount', 42000, 'commission_rate', 10, 'start_date', today, 'expiry_date', today + 364));
    SELECT * INTO r FROM leads WHERE id = l1;
    ASSERT r.policy_id = pol AND r.client_id IS NOT NULL, 'lead linked to client and policy';
    ASSERT (SELECT (status, agent_id, premium_amount, client_id) FROM policies WHERE id = pol) = ('pending'::text, a1, 42000::numeric, r.client_id), 'pending policy for the agent';
    ASSERT (SELECT (name, phone) FROM clients WHERE id = r.client_id) = ('Mary Wanjiku'::text, '0712000020'::text), 'client from lead';
    PERFORM _t020_expect(format('SELECT convert_lead(%L, %L::jsonb)', l1, '{}'), 'Already converted');

    -- timeline: contacts, moves and conversion
    SELECT count(*) INTO n FROM lead_activities WHERE lead_id = l1;
    ASSERT n >= 6, format('timeline has contacts, moves and conversion (%s)', n);
    ASSERT EXISTS (SELECT 1 FROM lead_activities WHERE lead_id = l1 AND kind = 'converted'), 'conversion logged';

    -- pipeline view counts only what the caller can see
    ASSERT (SELECT count FROM lead_pipeline WHERE stage = 'paid') = 1, 'pipeline counts';

    -- unpaid agency can't create leads
    PERFORM _t020_as(o2);
    PERFORM _t020_expect('SELECT create_lead(''{"full_name":"Z"}''::jsonb)', 'Subscription inactive: the agency is read-only until payment');
    RESET ROLE;
  END;

  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT NOT has_function_privilege('anon', 'public.create_lead(jsonb)', 'EXECUTE'), 'grant: anon';
  ASSERT NOT has_table_privilege('anon', 'public.leads', 'SELECT'), 'anon cannot read leads';
  ASSERT EXISTS (SELECT 1 FROM demo_snapshot.agencies) AND to_regclass('demo_snapshot.leads') IS NOT NULL, 'demo copy covers leads';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                      WHERE c.relname IN ('leads', 'lead_activities') AND NOT tg.tgisinternal
                        AND pg_get_triggerdef(tg.oid) NOT LIKE '%ams.demo_restore%'), 'lead triggers carry the demo guard';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
