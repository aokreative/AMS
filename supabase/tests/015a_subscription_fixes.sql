-- ============================================================
-- Test 015a: subscription review fixes
--   #1 Owner cannot write billing columns on agencies directly
--   #2 a payment created against an older plan state is not applied
--      automatically (status needs_review, agency unchanged)
--   #4 a read-only agency can still reduce usage: cancel/expire a
--      policy, remove a member, revoke an invite
-- One transaction, always rolled back; prints 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t015a_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
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
GRANT EXECUTE ON FUNCTION public._t015a_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t015a_as(p_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END; $$;
GRANT EXECUTE ON FUNCTION public._t015a_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag  UUID := gen_random_uuid();
  o   UUID := gen_random_uuid();
  a   UUID := gen_random_uuid();
  i1  UUID; pl UUID;
  cl1 UUID := gen_random_uuid();
  p1  UUID := gen_random_uuid();
  p2  UUID := gen_random_uuid();
  inv UUID;
  pay_up UUID; pay_ext UUID; pay_ok UUID;
  v_bool BOOLEAN;
  v_date DATE;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o, 'o-015a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a, 'a-015a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name, paid_until) VALUES (ag, 'Test Agency 015a', today + 30);
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (o, ag, 'owner', 'Owner 015a', 'o-015a@test.local'),
    (a, ag, 'agent', 'Agent 015a', 'a-015a@test.local');
  INSERT INTO insurers (agency_id, name) VALUES (ag, 'Insurer 015a') RETURNING id INTO i1;
  INSERT INTO product_lines (agency_id, name) VALUES (ag, 'Motor 015a') RETURNING id INTO pl;
  INSERT INTO clients (id, agency_id, type, name, assigned_agent_id) VALUES (cl1, ag, 'individual', 'Client 015a', a);
  INSERT INTO policies (id, agency_id, client_id, insurer_id, product_line_id, agent_id,
                        policy_number, premium_amount, commission_rate, commission_basis,
                        start_date, expiry_date, status)
  VALUES (p1, ag, cl1, i1, pl, a, 'T015a-P1', 12000, 10, 'annual', today - 300, today + 20, 'active'),
         (p2, ag, cl1, i1, pl, a, 'T015a-P2', 12000, 10, 'annual', today - 300, today + 40, 'active');

  -- ---------------------------------------------------------
  -- #1 billing columns are not writable by the Owner
  -- ---------------------------------------------------------
  BEGIN
    PERFORM _t015a_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM _t015a_expect(format('UPDATE agencies SET paid_until = %L WHERE id = %L', '2099-01-01', ag), NULL, '42501');
    PERFORM _t015a_expect(format('UPDATE agencies SET complimentary_until = %L WHERE id = %L', '2099-01-01', ag), NULL, '42501');
    PERFORM _t015a_expect(format('UPDATE agencies SET subscription_tier = %L WHERE id = %L', 'enterprise_plus', ag), NULL, '42501');
    PERFORM _t015a_expect(format('UPDATE agencies SET terms_accepted_at = now() WHERE id = %L', ag), NULL, '42501');
    -- profile fields stay editable
    UPDATE agencies SET name = 'Renamed 015a', email = 'x@test.local', phone = '0700', address = 'Nairobi' WHERE id = ag;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT name FROM agencies WHERE id = ag) = 'Renamed 015a', '#1: profile update applied';

  -- ---------------------------------------------------------
  -- #2 stale payments are held for review
  -- ---------------------------------------------------------
  UPDATE agencies SET subscription_tier = 'starter', paid_until = today WHERE id = ag;
  SELECT create_subscription_payment(ag, 'enterprise_plus', 0, 884) INTO pay_up;     -- upgrade priced on 1 day left
  SELECT create_subscription_payment(ag, 'starter', 12, 42000) INTO pay_ext;
  SELECT apply_subscription_payment(pay_ext::text, 'mobile_money', '{}'::jsonb) INTO v_bool;
  ASSERT v_bool, '#2: renewal applied';
  SELECT paid_until INTO v_date FROM agencies WHERE id = ag;
  SELECT apply_subscription_payment(pay_up::text, 'card', '{"late":true}'::jsonb) INTO v_bool;
  ASSERT NOT v_bool, '#2: stale upgrade not applied';
  ASSERT (SELECT (subscription_tier, paid_until) FROM agencies WHERE id = ag) = ('starter'::text, v_date), '#2: agency unchanged';
  ASSERT (SELECT (status, channel, raw) FROM subscription_payments WHERE id = pay_up)
         = ('needs_review'::text, 'card'::text, '{"late":true}'::jsonb), '#2: stale payment marked needs_review';
  -- replaying the stale one changes nothing either
  SELECT apply_subscription_payment(pay_up::text, 'card', '{}'::jsonb) INTO v_bool;
  ASSERT NOT v_bool, '#2: replay of needs_review is a no-op';
  -- a payment created against the current state still applies
  SELECT create_subscription_payment(ag, 'growth', 1, 7000) INTO pay_ok;
  SELECT apply_subscription_payment(pay_ok::text, 'card', '{}'::jsonb) INTO v_bool;
  ASSERT v_bool, '#2: fresh payment applied';
  ASSERT (SELECT (subscription_tier, paid_until) FROM agencies WHERE id = ag) = ('growth'::text, (v_date + interval '1 month')::date), '#2: fresh payment extended';

  -- ---------------------------------------------------------
  -- #4 read-only agency can reduce usage
  -- ---------------------------------------------------------
  UPDATE agencies SET paid_until = today - 10 WHERE id = ag;
  ASSERT agency_access(ag) = 'read_only', '#4: fixture is read-only';
  INSERT INTO agency_invites (agency_id, email, role, token_hash, invited_by)
  VALUES (ag, 'z-015a@test.local', 'agent', md5(random()::text), o) RETURNING id INTO inv;
  BEGIN
    PERFORM _t015a_as(o);
    SET LOCAL ROLE authenticated;
    -- cancelling or expiring a policy is allowed
    UPDATE policies SET status = 'cancelled' WHERE id = p1;
    -- any other change is still refused
    PERFORM _t015a_expect(format('UPDATE policies SET premium_amount = 1 WHERE id = %L', p2),
      'Subscription inactive: the agency is read-only until payment', 'P0001');
    PERFORM _t015a_expect(format('UPDATE policies SET status = %L WHERE id = %L', 'active', p1),
      'Subscription inactive: the agency is read-only until payment', 'P0001');
    -- revoking an invite and removing a member are allowed
    PERFORM revoke_invite(inv);
    PERFORM remove_member(a, o);
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  ASSERT (SELECT status FROM policies WHERE id = p1) = 'cancelled', '#4: policy cancelled';
  ASSERT (SELECT revoked_at FROM agency_invites WHERE id = inv) IS NOT NULL, '#4: invite revoked';
  ASSERT (SELECT deactivated_at FROM users WHERE id = a) IS NOT NULL, '#4: member removed';
  ASSERT (SELECT agent_id FROM policies WHERE id = p2) = o, '#4: active policy moved to owner';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
