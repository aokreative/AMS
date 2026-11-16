-- ============================================================
-- Test 016: onboarding, currency, language, multiple owners
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t016_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t016_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t016_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t016_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag  UUID := gen_random_uuid();
  o   UUID := gen_random_uuid();
  m   UUID := gen_random_uuid();
  a   UUID := gen_random_uuid();
  inv UUID := gen_random_uuid();
  v_js JSONB;
  v_code TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- tiers
  ASSERT (SELECT array_agg(max_owners ORDER BY sort_order) FROM subscription_tiers)::text = '{1,2,3,NULL}', 'max_owners per tier';

  -- existing agencies are already set up
  ASSERT (SELECT setup_completed_at FROM agencies WHERE id = '00ca4ec4-7ca5-4f84-a9ef-ef8b6e3b006c') IS NOT NULL, 'demo agency set up';

  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o,   'o-016@test.local',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (m,   'm-016@test.local',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a,   'a-016@test.local',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (inv, 'inv-016@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, subscription_tier, paid_until) VALUES (ag, 'Test Agency 016', 'growth', today + 30);
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (o, ag, 'owner',   'Owner 016',   'o-016@test.local'),
    (m, ag, 'manager', 'Manager 016', 'm-016@test.local'),
    (a, ag, 'agent',   'Agent 016',   'a-016@test.local');

  -- defaults
  ASSERT (SELECT (currency, language, setup_completed_at IS NULL) FROM agencies WHERE id = ag) = ('KES'::text, 'en'::text, true), 'new agency defaults';

  -- ---------------------------------------------------------
  -- setup and language
  -- ---------------------------------------------------------
  BEGIN
    PERFORM _t016_as(m);
    SET LOCAL ROLE authenticated;
    PERFORM _t016_expect('SELECT complete_agency_setup(''sw'', ''TZS'')', 'Only the owner can do that', '42501');
    PERFORM _t016_as(o);
    PERFORM _t016_expect('SELECT complete_agency_setup(''sw'', ''EUR'')', 'Pick a currency');
    PERFORM _t016_expect('SELECT complete_agency_setup(''xx'', ''TZS'')', 'Pick a language');
    PERFORM complete_agency_setup('sw', 'TZS');
    -- currency and language are not directly writable
    PERFORM _t016_expect(format('UPDATE agencies SET currency = %L WHERE id = %L', 'USD', ag), NULL, '42501');
    PERFORM _t016_expect(format('UPDATE agencies SET setup_completed_at = NULL WHERE id = %L', ag), NULL, '42501');
    PERFORM _t016_as(a);
    PERFORM set_my_language('fr');
    PERFORM _t016_expect('SELECT set_my_language(''xx'')', 'Pick a language');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT (currency, language, setup_completed_at IS NOT NULL) FROM agencies WHERE id = ag) = ('TZS'::text, 'sw'::text, true), 'setup saved';
  ASSERT (SELECT language FROM users WHERE id = a) = 'fr', 'user language saved';

  -- ---------------------------------------------------------
  -- multiple owners (growth: 2 owners)
  -- ---------------------------------------------------------
  BEGIN
    PERFORM _t016_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM change_member_role(m, 'owner');
    PERFORM _t016_expect(format('SELECT change_member_role(%L, %L)', a, 'owner'), 'Your plan allows 2 owners. Upgrade to add more.');
    PERFORM _t016_expect('SELECT create_invite(''x-016@test.local'', ''owner'')', 'Your plan allows 2 owners. Upgrade to add more.');
    PERFORM _t016_expect(format('SELECT change_member_role(%L, %L)', a, 'admin'), 'Role must be owner, manager or agent', '22023');
    -- demote the second owner back, then invite an owner instead
    PERFORM change_member_role(m, 'manager');
    SELECT create_invite('inv-016@test.local', 'owner') INTO v_js;
    v_code := v_js->>'code';
    -- with an owner invite pending, promoting would exceed the limit
    PERFORM _t016_expect(format('SELECT change_member_role(%L, %L)', m, 'owner'), 'Your plan allows 2 owners. Upgrade to add more.');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);

  BEGIN
    PERFORM _t016_as(inv);
    SET LOCAL ROLE authenticated;
    SELECT accept_invite(v_code, 'Second Owner', true) INTO v_js;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT role FROM users WHERE id = inv) = 'owner', 'invited owner joined as owner';

  -- the new owner can manage the team, including the other owner
  BEGIN
    PERFORM _t016_as(inv);
    SET LOCAL ROLE authenticated;
    PERFORM _t016_expect(format('SELECT remove_member(%L, %L)', inv, o), 'You cannot remove yourself', '42501');
    PERFORM remove_member(o, inv);
    -- now the last owner
    PERFORM _t016_expect(format('SELECT change_member_role(%L, %L)', inv, 'manager'), 'The last owner cannot be changed or removed', '42501');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT deactivated_at FROM users WHERE id = o) IS NOT NULL, 'owner removed by the other owner';

  -- ---------------------------------------------------------
  -- starter allows 1 owner; tier check counts owners
  -- ---------------------------------------------------------
  UPDATE users SET deactivated_at = NULL WHERE id = o;     -- back to 2 owners (o, inv), 4 members
  UPDATE users SET deactivated_at = now() WHERE id = a;    -- 3 active members
  PERFORM _t016_expect(format('SELECT subscription_check_tier(%L, %L)', ag, 'starter'), 'Remove 1 owner first');
  UPDATE agencies SET subscription_tier = 'starter' WHERE id = ag;
  UPDATE users SET role = 'manager' WHERE id = inv;         -- 1 owner
  BEGIN
    PERFORM _t016_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM _t016_expect(format('SELECT change_member_role(%L, %L)', m, 'owner'), 'Your plan allows 1 owner. Upgrade to add more.');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  -- comped agencies have no owner limit
  UPDATE agencies SET complimentary_until = today + 10 WHERE id = ag;
  BEGIN
    PERFORM _t016_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM change_member_role(m, 'owner');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT role FROM users WHERE id = m) = 'owner', 'comped: second owner allowed';

  -- grants
  ASSERT NOT has_function_privilege('anon', 'public.complete_agency_setup(text, text)', 'EXECUTE'), 'grant: setup anon';
  ASSERT NOT has_function_privilege('anon', 'public.set_my_language(text)', 'EXECUTE'), 'grant: language anon';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
