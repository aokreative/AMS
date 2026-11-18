-- ============================================================
-- Test 018: superadmin (admin list, suspension, custom price, comp,
-- paid-until, plan change, action log, access control)
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t018_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t018_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t018_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t018_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag  UUID := gen_random_uuid();
  o   UUID := gen_random_uuid();
  a   UUID := gen_random_uuid();
  i1  UUID; pl UUID;
  cl  UUID := gen_random_uuid();
  p1  UUID := gen_random_uuid();
  n   INTEGER;
  j   JSONB;
  calls TEXT[] := ARRAY[
    'SELECT admin_overview()',
    'SELECT admin_list_agencies()',
    format('SELECT admin_agency_detail(%L)', NULL),
    format('SELECT admin_suspend(%L, %L)', NULL, 'x'),
    format('SELECT admin_reactivate(%L, %L)', NULL, 'x'),
    format('SELECT admin_set_custom_price(%L, 100, %L)', NULL, 'x'),
    format('SELECT admin_set_comp(%L, NULL, %L)', NULL, 'x'),
    format('SELECT admin_set_paid_until(%L, current_date, %L)', NULL, 'x'),
    format('SELECT admin_set_tier(%L, %L, %L)', NULL, 'growth', 'x')
  ];
  c TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o, 'o-018@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a, 'a-018@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until, setup_completed_at) VALUES (ag, 'Test Agency 018', today + 30, now());
  INSERT INTO users (id, agency_id, role, full_name, email, phone) VALUES (o, ag, 'owner', 'Owner 018', 'o-018@test.local', '0700018018');
  INSERT INTO platform_admins (user_id) VALUES (a);
  INSERT INTO insurers (agency_id, name) VALUES (ag, 'Insurer 018') RETURNING id INTO i1;
  INSERT INTO product_lines (agency_id, name) VALUES (ag, 'Motor 018') RETURNING id INTO pl;
  INSERT INTO clients (id, agency_id, type, name, assigned_agent_id) VALUES (cl, ag, 'individual', 'Client 018', o);
  INSERT INTO policies (id, agency_id, client_id, insurer_id, product_line_id, agent_id,
                        policy_number, premium_amount, commission_rate, commission_basis,
                        start_date, expiry_date, status)
  VALUES (p1, ag, cl, i1, pl, o, 'T018-P1', 15000, 10, 'annual', today - 10, today + 355, 'active');

  BEGIN
    SET LOCAL ROLE authenticated;

    -- (a) an agency Owner is not a superadmin
    PERFORM _t018_as(o);
    ASSERT NOT is_platform_admin(), 'owner is not an admin';
    FOREACH c IN ARRAY calls LOOP
      PERFORM _t018_expect(c, 'Only a superadmin can do that', '42501');
    END LOOP;
    -- (k) no direct access to the admin tables
    PERFORM _t018_expect('SELECT count(*) FROM platform_admins', NULL, '42501');
    PERFORM _t018_expect('SELECT count(*) FROM admin_actions', NULL, '42501');
    -- owners can't set the new agency columns themselves
    PERFORM _t018_expect(format('UPDATE agencies SET custom_price_kes = 1 WHERE id = %L', ag), NULL, '42501');

    PERFORM _t018_as(a);
    ASSERT is_platform_admin(), 'admin is an admin';

    -- (e) a note is required
    PERFORM _t018_expect(format('SELECT admin_suspend(%L, %L)', ag, '  '), 'Add a note');

    -- (b) suspend
    PERFORM admin_suspend(ag, 'Unpaid invoice');
    PERFORM _t018_expect(format('SELECT admin_suspend(%L, %L)', ag, 'again'), 'Already suspended');

    -- (j) overview and list
    j := admin_overview();
    ASSERT (j->'counts'->>'suspended')::int >= 1, 'overview counts suspended';
    SELECT x INTO j FROM admin_list_agencies() x WHERE x->>'id' = ag::text;
    ASSERT j->>'status' = 'suspended', format('list status suspended, got %s', j->>'status');
    ASSERT j->>'suspended_reason' = 'Unpaid invoice', 'reason listed';
    ASSERT (j->>'members')::int = 1 AND (j->>'active_policies')::int = 1, 'counts listed';
    ASSERT j->'owners'->0->>'email' = 'o-018@test.local', 'owner listed';

    -- (c) members of a suspended agency can't write, not even a cancel
    PERFORM _t018_as(o);
    PERFORM _t018_expect(format('INSERT INTO clients (agency_id, type, name) VALUES (%L, %L, %L)', ag, 'individual', 'X'), 'This account is suspended');
    PERFORM _t018_expect(format('UPDATE policies SET status = %L WHERE id = %L', 'cancelled', p1), 'This account is suspended');

    -- (d) reactivate
    PERFORM _t018_as(a);
    PERFORM admin_reactivate(ag, 'Paid by bank');
    PERFORM _t018_expect(format('SELECT admin_reactivate(%L, %L)', ag, 'again'), 'Not suspended');
    PERFORM _t018_as(o);
    INSERT INTO clients (agency_id, type, name) VALUES (ag, 'individual', 'After reactivation 018');

    -- (f) custom price
    PERFORM _t018_as(a);
    PERFORM _t018_expect(format('SELECT admin_set_custom_price(%L, 0, %L)', ag, 'x'), 'Enter a price above 0');
    PERFORM admin_set_custom_price(ag, 2500, 'Launch discount');
    SELECT x INTO j FROM admin_list_agencies() x WHERE x->>'id' = ag::text;
    ASSERT (j->>'price_kes')::int = 2500 AND (j->>'custom_price_kes')::int = 2500, 'custom price listed';
    PERFORM admin_set_custom_price(ag, NULL, 'Back to standard');

    -- (g) comp
    PERFORM _t018_expect(format('SELECT admin_set_comp(%L, %L, %L)', ag, today - 1, 'x'), 'Pick today or a later date');
    PERFORM admin_set_comp(ag, today + 60, 'Pilot');
    PERFORM admin_set_comp(ag, NULL, 'Pilot over');

    -- paid-until
    PERFORM _t018_expect(format('SELECT admin_set_paid_until(%L, NULL, %L)', ag, 'x'), 'Pick a date');
    PERFORM admin_set_paid_until(ag, today + 90, 'Cash payment');

    -- (h) plan
    PERFORM _t018_expect(format('SELECT admin_set_tier(%L, %L, %L)', ag, 'gold', 'x'), 'Pick a plan');
    PERFORM admin_set_tier(ag, 'growth', 'Upgrade by phone');

    -- (i) one log row per successful action, with before/after
    j := admin_agency_detail(ag);
    n := jsonb_array_length(j->'actions');
    ASSERT n = 8, format('8 actions logged, got %s', n);
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'actions') e
                    WHERE e->>'action' = 'set_tier' AND e->'before'->>'subscription_tier' = 'starter'
                      AND e->'after'->>'subscription_tier' = 'growth' AND e->>'admin_email' = 'a-018@test.local'),
           'set_tier logged with before/after';
    RESET ROLE;
  END;

  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT (suspended_at IS NULL, custom_price_kes IS NULL, complimentary_until IS NULL, paid_until, subscription_tier)
            FROM agencies WHERE id = ag) = (true, true, true, today + 90, 'growth'::text), 'final agency state';
  ASSERT NOT has_function_privilege('anon', 'public.admin_list_agencies()', 'EXECUTE'), 'grant: anon';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
