-- ============================================================
-- Test 020b: set a lead's follow-up date without logging a contact
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t020b_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t020b_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t020b_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t020b_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag UUID := gen_random_uuid();
  a1 UUID := gen_random_uuid();
  a2 UUID := gen_random_uuid();
  l1 UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (a1, 'a1-020b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a2, 'a2-020b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until, setup_completed_at) VALUES (ag, 'Follow-up Agency 020b', today + 30, now());
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (a1, ag, 'agent', 'Agent One', 'a1-020b@test.local'),
    (a2, ag, 'agent', 'Agent Two', 'a2-020b@test.local');

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM _t020b_as(a1);
    l1 := create_lead(jsonb_build_object('full_name', 'Jane Njeri'));

    PERFORM set_lead_follow_up(l1, today + 2);
    ASSERT (SELECT next_follow_up FROM leads WHERE id = l1) = today + 2, 'follow-up set';
    ASSERT (SELECT stage FROM leads WHERE id = l1) = 'new', 'setting a date does not move the stage';
    PERFORM set_lead_follow_up(l1, NULL);
    ASSERT (SELECT next_follow_up FROM leads WHERE id = l1) IS NULL, 'follow-up cleared';
    PERFORM _t020b_expect(format('SELECT set_lead_follow_up(%L, %L)', l1, today - 1), 'Pick today or a later date');

    -- someone else's lead is out of reach
    PERFORM _t020b_as(a2);
    PERFORM _t020b_expect(format('SELECT set_lead_follow_up(%L, %L)', l1, today), 'Lead not found');

    -- closed leads have no follow-ups
    PERFORM _t020b_as(a1);
    PERFORM mark_lead_lost(l1, 'no_response', NULL);
    PERFORM _t020b_expect(format('SELECT set_lead_follow_up(%L, %L)', l1, today), 'This lead is closed. Reopen it first.');
    RESET ROLE;
  END;

  ASSERT NOT has_function_privilege('anon', 'public.set_lead_follow_up(uuid, date)', 'EXECUTE'), 'grant: anon';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
