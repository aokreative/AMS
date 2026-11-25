-- ============================================================
-- Test 021: exchange rates for showing plan prices in the agency's
-- currency (payments are still charged in KES)
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;

CREATE FUNCTION public._t021_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t021_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t021_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t021_as(UUID) TO authenticated;

DO $$
DECLARE
  ag UUID := gen_random_uuid();
  o  UUID := gen_random_uuid();
  a  UUID := gen_random_uuid();
  n  INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o, 'o-021@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a, 'a-021@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until, setup_completed_at) VALUES (ag, 'Rates Agency 021', current_date + 30, now());
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES (o, ag, 'owner', 'Owner 021', 'o-021@test.local');
  INSERT INTO platform_admins (user_id) VALUES (a);

  -- every supported currency has a rate; KES is 1
  SELECT count(*) INTO n FROM exchange_rates WHERE currency IN ('KES', 'TZS', 'UGX', 'USD') AND kes_per_unit > 0;
  ASSERT n = 4, format('four rates, got %s', n);
  ASSERT (SELECT kes_per_unit FROM exchange_rates WHERE currency = 'KES') = 1, 'KES is 1';

  BEGIN
    SET LOCAL ROLE authenticated;
    -- any signed-in member can read the rates
    PERFORM _t021_as(o);
    SELECT count(*) INTO n FROM exchange_rates;
    ASSERT n >= 4, 'owner reads rates';
    -- but only a superadmin can change them
    PERFORM _t021_expect('SELECT admin_set_exchange_rate(''USD'', 130)', 'Only a superadmin can do that', '42501');
    PERFORM _t021_expect('UPDATE exchange_rates SET kes_per_unit = 1 WHERE currency = ''USD''', NULL, '42501');

    PERFORM _t021_as(a);
    PERFORM admin_set_exchange_rate('USD', 130.5);
    ASSERT (SELECT (kes_per_unit, updated_by) FROM exchange_rates WHERE currency = 'USD') = (130.5::numeric, a), 'USD updated';
    PERFORM _t021_expect('SELECT admin_set_exchange_rate(''USD'', 0)', 'Enter a rate above 0');
    PERFORM _t021_expect('SELECT admin_set_exchange_rate(''EUR'', 140)', 'Pick a currency');
    PERFORM _t021_expect('SELECT admin_set_exchange_rate(''KES'', 2)', 'KES is always 1');
    RESET ROLE;
  END;

  ASSERT has_table_privilege('anon', 'public.exchange_rates', 'SELECT'), 'the public demo can read rates';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_exchange_rate(text, numeric)', 'EXECUTE'), 'grant: anon';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
