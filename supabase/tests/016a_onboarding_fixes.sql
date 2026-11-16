-- ============================================================
-- Test 016a: onboarding review fixes
--   - currency is fixed once setup is done (language stays editable)
--   - demoting someone revokes the pending invites their new role
--     could not send
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t016a_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t016a_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t016a_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t016a_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag UUID := gen_random_uuid();
  a  UUID := gen_random_uuid();
  b  UUID := gen_random_uuid();
  n  INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (a, 'a-016a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (b, 'b-016a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, subscription_tier, paid_until) VALUES (ag, 'Test Agency 016a', 'enterprise', today + 30);
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (a, ag, 'owner', 'Owner A', 'a-016a@test.local'),
    (b, ag, 'owner', 'Owner B', 'b-016a@test.local');

  -- currency is fixed after setup; language is not
  BEGIN
    PERFORM _t016a_as(a);
    SET LOCAL ROLE authenticated;
    PERFORM complete_agency_setup('en', 'UGX');
    PERFORM complete_agency_setup('fr', 'UGX');
    PERFORM _t016a_expect('SELECT complete_agency_setup(''fr'', ''USD'')', 'The currency can''t be changed after setup');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT (currency, language) FROM agencies WHERE id = ag) = ('UGX'::text, 'fr'::text), 'currency kept, language changed';

  -- B sends owner, manager and agent invites
  BEGIN
    PERFORM _t016a_as(b);
    SET LOCAL ROLE authenticated;
    PERFORM create_invite('o-016a@test.local', 'owner');
    PERFORM create_invite('m-016a@test.local', 'manager');
    PERFORM create_invite('g-016a@test.local', 'agent');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- demoted to manager: owner and manager invites revoked, agent invite stays
  BEGIN
    PERFORM _t016a_as(a);
    SET LOCAL ROLE authenticated;
    PERFORM change_member_role(b, 'manager');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT count(*) INTO n FROM agency_invites WHERE agency_id = ag AND invited_by = b AND revoked_at IS NULL;
  ASSERT n = 1, format('manager keeps 1 invite, got %s', n);
  ASSERT (SELECT role FROM agency_invites WHERE agency_id = ag AND invited_by = b AND revoked_at IS NULL) = 'agent', 'kept invite is the agent one';

  -- demoted to agent: everything revoked
  BEGIN
    PERFORM _t016a_as(a);
    SET LOCAL ROLE authenticated;
    PERFORM change_member_role(b, 'agent');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT count(*) INTO n FROM agency_invites WHERE agency_id = ag AND invited_by = b AND revoked_at IS NULL;
  ASSERT n = 0, format('agent keeps no invites, got %s', n);
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
