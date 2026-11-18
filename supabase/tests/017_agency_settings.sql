-- ============================================================
-- Test 017: agency language/currency in Settings (Owner only, logged)
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t017_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t017_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t017_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t017_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag  UUID := gen_random_uuid();
  ag2 UUID := gen_random_uuid();
  o   UUID := gen_random_uuid();
  m   UUID := gen_random_uuid();
  ob  UUID := gen_random_uuid();
  i1  UUID; pl UUID;
  cl  UUID := gen_random_uuid();
  p1  UUID := gen_random_uuid();
  n   INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o,  'o-017@test.local',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (m,  'm-017@test.local',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (ob, 'ob-017@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until, setup_completed_at) VALUES
    (ag, 'Test Agency 017', today + 30, now()), (ag2, 'Other 017', today + 30, now());
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (o,  ag,  'owner',   'Owner 017',   'o-017@test.local'),
    (m,  ag,  'manager', 'Manager 017', 'm-017@test.local'),
    (ob, ag2, 'owner',   'OwnerB 017',  'ob-017@test.local');
  INSERT INTO insurers (agency_id, name) VALUES (ag, 'Insurer 017') RETURNING id INTO i1;
  INSERT INTO product_lines (agency_id, name) VALUES (ag, 'Motor 017') RETURNING id INTO pl;
  INSERT INTO clients (id, agency_id, type, name, assigned_agent_id) VALUES (cl, ag, 'individual', 'Client 017', o);
  INSERT INTO policies (id, agency_id, client_id, insurer_id, product_line_id, agent_id,
                        policy_number, premium_amount, commission_rate, commission_basis,
                        start_date, expiry_date, status)
  VALUES (p1, ag, cl, i1, pl, o, 'T017-P1', 15000, 10, 'annual', today - 10, today + 355, 'active');

  BEGIN
    PERFORM _t017_as(m);
    SET LOCAL ROLE authenticated;
    PERFORM _t017_expect('SELECT set_agency_currency(''USD'')', 'Only the owner can do that', '42501');
    PERFORM _t017_expect('SELECT set_agency_language(''fr'')', 'Only the owner can do that', '42501');
    -- managers can't read the history either
    SELECT count(*) INTO n FROM agency_setting_changes WHERE agency_id = ag;
    ASSERT n = 0, 'manager sees no history';

    PERFORM _t017_as(o);
    PERFORM _t017_expect('SELECT set_agency_currency(''EUR'')', 'Pick a currency');
    PERFORM _t017_expect('SELECT set_agency_language(''xx'')', 'Pick a language');
    -- a currency change relabels, never converts
    PERFORM set_agency_currency('USD');
    PERFORM set_agency_currency('USD');            -- no change: not logged
    PERFORM set_agency_language('sw');
    -- switching back restores the original label
    PERFORM set_agency_currency('KES');
    SELECT count(*) INTO n FROM agency_setting_changes WHERE agency_id = ag;
    ASSERT n = 3, format('3 changes logged, got %s', n);
    -- (all rows share now() inside this transaction, so don't rely on order)
    ASSERT EXISTS (SELECT 1 FROM agency_setting_changes
                    WHERE agency_id = ag AND setting = 'currency'
                      AND old_value = 'KES' AND new_value = 'USD' AND changed_by = o), 'first currency change recorded';
    -- other agency sees nothing; no direct writes
    PERFORM _t017_as(ob);
    SELECT count(*) INTO n FROM agency_setting_changes WHERE agency_id = ag;
    ASSERT n = 0, 'other agency sees no history';
    PERFORM _t017_expect(format('INSERT INTO agency_setting_changes (agency_id, setting, old_value, new_value) VALUES (%L, %L, %L, %L)', ag, 'currency', 'KES', 'USD'), NULL, '42501');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT (currency, language) FROM agencies WHERE id = ag) = ('KES'::text, 'sw'::text), 'settings saved';
  ASSERT (SELECT premium_amount FROM policies WHERE id = p1) = 15000, 'amounts never change';

  ASSERT NOT has_function_privilege('anon', 'public.set_agency_currency(text)', 'EXECUTE'), 'grant: currency anon';
  ASSERT NOT has_function_privilege('anon', 'public.set_agency_language(text)', 'EXECUTE'), 'grant: language anon';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
