-- ============================================================
-- Test 019: resettable demo agency for superadmins
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t019_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t019_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t019_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t019_as(UUID) TO authenticated;

DO $$
DECLARE
  demo  UUID := (SELECT id FROM agencies WHERE is_demo);
  a     UUID := gen_random_uuid();   -- superadmin, no agency yet
  a2    UUID := gen_random_uuid();   -- superadmin who belongs to a real agency
  o     UUID := gen_random_uuid();   -- ordinary owner
  nm    UUID := gen_random_uuid();   -- someone who joins the demo during a session
  n_earn INTEGER;
  n_tx   INTEGER;
  ag    UUID := gen_random_uuid();
  n_clients   INTEGER;
  n_policies  INTEGER;
  n_users     INTEGER;
  demo_name   TEXT;
  demo_owner  UUID;
  n INTEGER;
BEGIN
  ASSERT demo = '00ca4ec4-7ca5-4f84-a9ef-ef8b6e3b006c', 'the demo is marked by its id';
  ASSERT (SELECT count(*) FROM agencies WHERE is_demo) = 1, 'exactly one demo agency';
  SELECT count(*) INTO n_clients  FROM clients  WHERE agency_id = demo;
  SELECT count(*) INTO n_policies FROM policies WHERE agency_id = demo;
  SELECT count(*) INTO n_users    FROM users    WHERE agency_id = demo AND id NOT IN (SELECT user_id FROM platform_admins);
  SELECT count(*) INTO n_earn     FROM agent_earnings WHERE agency_id = demo;
  SELECT count(*) INTO n_tx       FROM commission_transactions WHERE agency_id = demo;
  SELECT name INTO demo_name FROM agencies WHERE id = demo;
  SELECT id INTO demo_owner FROM users WHERE agency_id = demo AND role = 'owner' ORDER BY created_at LIMIT 1;

  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (a,  'a-019@test.local',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a2, 'a2-019@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (o,  'o-019@test.local',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (nm, 'nm-019@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until, setup_completed_at) VALUES (ag, 'Real Agency 019', current_date + 30, now());
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (o,  ag, 'owner', 'Owner 019', 'o-019@test.local'),
    (a2, ag, 'owner', 'Admin2 019', 'a2-019@test.local');
  INSERT INTO platform_admins (user_id) VALUES (a), (a2);

  BEGIN
    SET LOCAL ROLE authenticated;

    -- only superadmins
    PERFORM _t019_as(o);
    PERFORM _t019_expect('SELECT admin_open_demo()', 'Only a superadmin can do that', '42501');
    PERFORM _t019_expect('SELECT admin_leave_demo()', 'Only a superadmin can do that', '42501');
    -- the snapshot is private
    PERFORM _t019_expect('SELECT count(*) FROM demo_snapshot.clients', NULL, '42501');

    -- a superadmin who belongs to a real agency can't be moved into the demo
    PERFORM _t019_as(a2);
    PERFORM _t019_expect('SELECT admin_open_demo()', 'This superadmin account belongs to an agency');

    -- open: the superadmin becomes an Owner of the demo agency
    PERFORM _t019_as(a);
    PERFORM admin_open_demo();
    ASSERT (SELECT (agency_id, role, deactivated_at IS NULL) FROM users WHERE id = a) = (demo, 'owner'::text, true), 'admin is demo owner';
    ASSERT current_user_agency_id() = demo, 'RLS sees the demo agency';

    -- everything works while inside the demo
    INSERT INTO clients (agency_id, type, name) VALUES (demo, 'individual', 'Demo session client 019');
    UPDATE policies SET premium_amount = premium_amount + 1000 WHERE agency_id = demo;
    UPDATE agencies SET name = 'Renamed in demo 019' WHERE id = demo;
    PERFORM set_agency_currency('USD');
    SELECT count(*) INTO n FROM clients WHERE agency_id = demo AND name = 'Demo session client 019';
    ASSERT n = 1, 'client added in demo';
    -- someone joins the demo (as if an invite were accepted)
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    INSERT INTO users (id, agency_id, role, full_name, email) VALUES (nm, demo, 'agent', 'Joined 019', 'nm-019@test.local');
    PERFORM _t019_as(a);
    SET LOCAL ROLE authenticated;

    -- leave: everything is back as it was saved
    PERFORM admin_leave_demo();
    -- check as the database owner: the superadmin's seat is switched off now
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    SELECT count(*) INTO n FROM clients WHERE agency_id = demo;
    ASSERT n = n_clients, format('clients restored: %s vs %s', n, n_clients);
    ASSERT NOT EXISTS (SELECT 1 FROM clients WHERE agency_id = demo AND name = 'Demo session client 019'), 'demo client gone';
    SELECT count(*) INTO n FROM policies WHERE agency_id = demo;
    ASSERT n = n_policies, 'policies restored';
    ASSERT (SELECT name FROM agencies WHERE id = demo) = demo_name, 'agency name restored';
    ASSERT (SELECT currency FROM agencies WHERE id = demo) = 'KES', 'currency restored';
    ASSERT NOT EXISTS (SELECT 1 FROM agency_setting_changes WHERE agency_id = demo AND new_value = 'USD'), 'settings history restored';
    -- generated commission column recomputed on restore
    ASSERT NOT EXISTS (SELECT 1 FROM policies WHERE agency_id = demo AND commission_expected IS NULL AND premium_amount IS NOT NULL
                         AND commission_rate IS NOT NULL), 'commission_expected present';
    -- demo members untouched, superadmin keeps its seat
    SELECT count(*) INTO n FROM users WHERE agency_id = demo AND id NOT IN (a, nm) AND id NOT IN (SELECT user_id FROM platform_admins);
    ASSERT n = n_users, 'demo members restored';
    ASSERT EXISTS (SELECT 1 FROM users WHERE id = a AND agency_id = demo AND deactivated_at IS NOT NULL), 'admin seat switched off after leaving';
    ASSERT (SELECT deactivated_at IS NOT NULL FROM users WHERE id = nm), 'people who joined during the demo are removed';
    SELECT count(*) INTO n FROM agent_earnings WHERE agency_id = demo;
    ASSERT n = n_earn, format('earnings restored, not regenerated: %s vs %s', n, n_earn);
    SELECT count(*) INTO n FROM commission_transactions WHERE agency_id = demo;
    ASSERT n = n_tx, 'commissions restored';

    -- opening again also starts from the saved copy
    INSERT INTO clients (agency_id, type, name, assigned_agent_id) VALUES (demo, 'individual', 'Leftover 019', demo_owner);
    PERFORM _t019_as(a);
    SET LOCAL ROLE authenticated;
    PERFORM admin_open_demo();
    ASSERT NOT EXISTS (SELECT 1 FROM clients WHERE agency_id = demo AND name = 'Leftover 019'), 'open resets leftovers';
    ASSERT (SELECT deactivated_at IS NULL AND role = 'owner' FROM users WHERE id = a), 'seat back on when reopening';

    -- other agencies are never touched
    PERFORM _t019_as(o);
    INSERT INTO clients (agency_id, type, name) VALUES (ag, 'individual', 'Real client 019');
    PERFORM _t019_as(a);
    PERFORM admin_leave_demo();
    RESET ROLE;
  END;

  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT EXISTS (SELECT 1 FROM clients WHERE agency_id = ag AND name = 'Real client 019'), 'real agency untouched';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
                     WHERE ns.nspname = 'public' AND NOT tg.tgisinternal AND tg.tgenabled = 'D'), 'triggers back on after restore';
  ASSERT NOT has_function_privilege('authenticated', 'public._demo_table_order()', 'EXECUTE'), 'order is internal';
  -- every table trigger steps aside during a demo reset (no table-wide DDL needed)
  ASSERT NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
                      WHERE ns.nspname = 'public' AND NOT tg.tgisinternal
                        AND pg_get_triggerdef(tg.oid) NOT LIKE '%ams.demo_restore%'), 'all triggers have the demo-reset guard';
  ASSERT pg_get_functiondef('public._demo_restore()'::regprocedure) NOT LIKE '%DISABLE TRIGGER%', 'no DDL in the reset';
  ASSERT NOT has_function_privilege('anon', 'public.admin_open_demo()', 'EXECUTE'), 'grant: anon';
  ASSERT NOT has_function_privilege('authenticated', 'public._demo_restore()', 'EXECUTE'), 'restore is internal';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
