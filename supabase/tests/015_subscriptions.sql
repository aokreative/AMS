-- ============================================================
-- Test 015: subscriptions
--   - tiers seeded; old CHECK gone
--   - agency_access states (active / grace / read_only / comped)
--   - enforce_subscription trigger: read-only blocks API writes,
--     ignores fixture (no JWT) writes, covers RPC writes
--   - system-write bypass for create_agency_with_owner / accept_invite
--   - member limit (invite + accept), policy limit (insert / status
--     change / renew_policy), comped agencies exempt
--   - subscription_check_tier, subscription_usage
--   - create_subscription_payment / apply_subscription_payment:
--     extend from today when lapsed, from paid_until when active,
--     idempotent, upgrade keeps paid_until, unknown reference,
--     month-end clamp
--   - payments RLS; consent recording; demo agency comped; cron job
--     created inactive; GUC setters allow-list
--
-- Run the whole file in one go. One transaction, ALWAYS rolled back:
-- on success the final SELECT returns 'ALL PASSED'.
-- ============================================================

BEGIN;
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE FUNCTION public._t015_expect(p_sql TEXT, p_msg TEXT, p_state TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_msg TEXT;
  v_st  TEXT;
  v_ran BOOLEAN := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_ran := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_st = RETURNED_SQLSTATE;
  END;
  ASSERT NOT v_ran, format('expected error %s %s, but it succeeded: %s', p_state, p_msg, p_sql);
  ASSERT (p_msg IS NULL OR v_msg = p_msg) AND (p_state IS NULL OR v_st = p_state),
    format('expected [%s] %s, got [%s] %s for: %s', p_state, p_msg, v_st, v_msg, p_sql);
END;
$$;
GRANT EXECUTE ON FUNCTION public._t015_expect(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public._t015_as(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END;
$$;
GRANT EXECUTE ON FUNCTION public._t015_as(UUID) TO authenticated;

DO $$
DECLARE
  today DATE := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  ag    UUID := gen_random_uuid();
  ag2   UUID := gen_random_uuid();
  o     UUID := gen_random_uuid();
  m     UUID := gen_random_uuid();
  a     UUID := gen_random_uuid();
  ob    UUID := gen_random_uuid();
  fresh UUID := gen_random_uuid();   -- creates a new agency
  inv   UUID := gen_random_uuid();   -- accepts an invite
  i1    UUID;
  pl    UUID;
  cl1   UUID := gen_random_uuid();
  p1    UUID := gen_random_uuid();
  p2    UUID := gen_random_uuid();
  pay   UUID;
  pay2  UUID;
  n     INTEGER;
  v_txt TEXT;
  v_js  JSONB;
  v_bool BOOLEAN;
  v_code TEXT;
  v_date DATE;
  v_new  UUID;
  v_bad  TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- ---------------------------------------------------------
  -- 0. Tiers and schema
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM subscription_tiers;
  ASSERT n = 4, format('tiers: expected 4 rows, got %s', n);
  ASSERT (SELECT (price_kes, max_members, max_active_policies, name) FROM subscription_tiers WHERE key = 'starter')
         = (3500, 3, 300, 'Starter'::text), 'tiers: starter';
  ASSERT (SELECT (price_kes, max_members, max_active_policies, name) FROM subscription_tiers WHERE key = 'growth')
         = (7000, 10, NULL::int, 'Growth'::text), 'tiers: growth';
  ASSERT (SELECT (price_kes, max_members, max_active_policies, name) FROM subscription_tiers WHERE key = 'enterprise')
         = (15000, 25, NULL::int, 'Enterprise'::text), 'tiers: enterprise';
  ASSERT (SELECT (price_kes, max_members, max_active_policies, name) FROM subscription_tiers WHERE key = 'enterprise_plus')
         = (30000, NULL::int, NULL::int, 'Enterprise Plus'::text), 'tiers: enterprise_plus';

  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (o,     'o-015@test.local',     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (m,     'm-015@test.local',     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (a,     'a-015@test.local',     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (ob,    'ob-015@test.local',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (fresh, 'fresh-015@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (inv,   'inv-015@test.local',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO agencies (id, name) VALUES (ag, 'Test Agency 015'), (ag2, 'Other Agency 015');
  PERFORM _t015_expect(format('UPDATE agencies SET subscription_tier = %L WHERE id = %L', 'pro', ag), NULL, '23503');

  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (o,  ag,  'owner',   'Owner 015',   'o-015@test.local'),
    (m,  ag,  'manager', 'Manager 015', 'm-015@test.local'),
    (a,  ag,  'agent',   'Agent 015',   'a-015@test.local'),
    (ob, ag2, 'owner',   'OwnerB 015',  'ob-015@test.local');
  -- fixture writes (no authenticated JWT) are never blocked, even while read-only
  INSERT INTO insurers (agency_id, name) VALUES (ag, 'Insurer 015') RETURNING id INTO i1;
  INSERT INTO product_lines (agency_id, name) VALUES (ag, 'Motor 015') RETURNING id INTO pl;
  INSERT INTO clients (id, agency_id, type, name, assigned_agent_id) VALUES (cl1, ag, 'individual', 'Client 015', a);
  INSERT INTO policies (id, agency_id, client_id, insurer_id, product_line_id, agent_id,
                        policy_number, premium_amount, commission_rate, commission_basis,
                        start_date, expiry_date, status)
  VALUES (p1, ag, cl1, i1, pl, a, 'T015-P1', 12000, 10, 'annual', today - 300, today + 20, 'active'),
         (p2, ag, cl1, i1, pl, a, 'T015-P2', 12000, 10, 'annual', today - 700, today - 335, 'expired');

  -- ---------------------------------------------------------
  -- 1. agency_access
  -- ---------------------------------------------------------
  UPDATE agencies SET paid_until = today + 5 WHERE id = ag;
  ASSERT agency_access(ag) = 'active', 'access: +5 active';
  UPDATE agencies SET paid_until = today WHERE id = ag;
  ASSERT agency_access(ag) = 'active', 'access: today active';
  UPDATE agencies SET paid_until = today - 3 WHERE id = ag;
  ASSERT agency_access(ag) = 'grace', 'access: -3 grace';
  UPDATE agencies SET paid_until = today - 4 WHERE id = ag;
  ASSERT agency_access(ag) = 'read_only', 'access: -4 read_only';
  UPDATE agencies SET paid_until = NULL WHERE id = ag;
  ASSERT agency_access(ag) = 'read_only', 'access: null read_only';
  UPDATE agencies SET complimentary_until = today WHERE id = ag;
  ASSERT agency_access(ag) = 'active', 'access: comped active';
  UPDATE agencies SET complimentary_until = NULL WHERE id = ag;

  -- ---------------------------------------------------------
  -- 2. Read-only enforcement for API users
  -- ---------------------------------------------------------
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect(format('INSERT INTO clients (agency_id, type, name, assigned_agent_id) VALUES (%L, %L, %L, %L)', ag, 'individual', 'Blocked', o),
      'Subscription inactive: the agency is read-only until payment', 'P0001');
    PERFORM _t015_expect(format('UPDATE insurers SET name = %L WHERE id = %L', 'Renamed', i1),
      'Subscription inactive: the agency is read-only until payment', 'P0001');
    PERFORM _t015_expect(format('DELETE FROM insurers WHERE id = %L', i1),
      'Subscription inactive: the agency is read-only until payment', 'P0001');
    -- RPC writes hit the same trigger
    PERFORM _t015_expect(format('SELECT log_renewal_contact(%L, %L, %L, NULL)', p1, 'phone', today),
      'Subscription inactive: the agency is read-only until payment', 'P0001');
    -- agency settings stay editable
    UPDATE agencies SET phone = '0700000000' WHERE id = ag;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes

  -- grace behaves as active
  UPDATE agencies SET paid_until = today - 2 WHERE id = ag;
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    UPDATE insurers SET name = 'Renamed in grace' WHERE id = i1;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes

  -- active: all three succeed
  UPDATE agencies SET paid_until = today + 30 WHERE id = ag;
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    INSERT INTO clients (agency_id, type, name, assigned_agent_id) VALUES (ag, 'individual', 'Allowed', o);
    UPDATE insurers SET name = 'Renamed' WHERE id = i1;
    DELETE FROM clients WHERE agency_id = ag AND name = 'Allowed';
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes

  -- ---------------------------------------------------------
  -- 3. System-write bypass: new agency, accept invite
  -- ---------------------------------------------------------
  BEGIN
    PERFORM _t015_as(fresh);
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect('SELECT create_agency_with_owner(''New Agency 015'', ''Fresh Owner'', NULL, false)',
      'Accept the Terms and Privacy Notice to continue');
    SELECT create_agency_with_owner('New Agency 015', 'Fresh Owner', NULL, true) INTO v_js;
    v_new := (v_js->>'agency_id')::uuid;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  ASSERT agency_access(v_new) = 'read_only', 'new agency starts read_only';
  SELECT count(*) INTO n FROM product_lines WHERE agency_id = v_new;
  ASSERT n > 0, 'new agency: product lines seeded despite read_only';
  ASSERT (SELECT terms_accepted_at FROM agencies WHERE id = v_new) IS NOT NULL, 'consent: agency terms_accepted_at';
  ASSERT (SELECT terms_accepted_at FROM users WHERE id = fresh) IS NOT NULL, 'consent: owner terms_accepted_at';

  -- invite created while active (growth: room for a 4th member), accepted while read-only
  UPDATE agencies SET subscription_tier = 'growth' WHERE id = ag;
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    SELECT create_invite('inv-015@test.local', 'agent') INTO v_js;
    v_code := v_js->>'code';
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  UPDATE agencies SET paid_until = NULL WHERE id = ag;
  BEGIN
    PERFORM _t015_as(inv);
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect(format('SELECT accept_invite(%L, %L, false)', v_code, 'Invited One'),
      'Accept the Terms and Privacy Notice to continue');
    SELECT accept_invite(v_code, 'Invited One', true) INTO v_js;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  ASSERT (SELECT agency_id FROM users WHERE id = inv) = ag, 'accept_invite while read_only succeeded';
  ASSERT (SELECT terms_accepted_at FROM users WHERE id = inv) IS NOT NULL, 'consent: invitee terms_accepted_at';

  -- allow-list of functions that may set the bypass GUC
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO v_bad
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosrc LIKE '%ams.system_write%'
     AND p.proname NOT IN ('create_agency_with_owner', 'accept_invite', 'enforce_subscription', 'remove_member', 'revoke_invite');
  ASSERT v_bad IS NULL, format('unexpected functions set ams.system_write: %s', v_bad);

  -- ---------------------------------------------------------
  -- 4. Member limit
  -- ---------------------------------------------------------
  UPDATE agencies SET subscription_tier = 'starter', paid_until = today + 30 WHERE id = ag;
  -- ag now has o, m, a, inv = 4 users on starter (limit 3): invites refused
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect('SELECT create_invite(''x1-015@test.local'', ''agent'')',
      'Your plan allows 3 team members. Upgrade to add more.');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  DELETE FROM agency_invites WHERE agency_id = ag;   -- (accepted invite references inv)
  DELETE FROM users WHERE id = inv;   -- back to 3 users: still at the limit
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect('SELECT create_invite(''x1-015@test.local'', ''agent'')',
      'Your plan allows 3 team members. Upgrade to add more.');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  UPDATE users SET deactivated_at = now() WHERE id = a;   -- 2 active members (a owns policies, so deactivate rather than delete)
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    SELECT create_invite('x1-015@test.local', 'agent') INTO v_js;   -- 2 users + 1 pending = 3
    PERFORM _t015_expect('SELECT create_invite(''x2-015@test.local'', ''agent'')',
      'Your plan allows 3 team members. Upgrade to add more.');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  UPDATE agencies SET subscription_tier = 'growth' WHERE id = ag;
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    SELECT create_invite('x2-015@test.local', 'agent') INTO v_js;   -- growth allows it
    v_code := v_js->>'code';
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  -- accept re-checks: back on starter with 3 users, the 4th cannot join
  -- (pending invites do not count here: joining with 3 members on a
  -- 3-member plan is the limit itself and is allowed)
  UPDATE agencies SET subscription_tier = 'starter' WHERE id = ag;
  UPDATE users SET deactivated_at = NULL WHERE id = a;   -- 3 active members
  INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
    (gen_random_uuid(), 'x2-015@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  BEGIN
    PERFORM _t015_as((SELECT id FROM auth.users WHERE email = 'x2-015@test.local'));
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect(format('SELECT accept_invite(%L, %L, true)', v_code, 'X Two'),
      'Your plan allows 3 team members. Upgrade to add more.');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  -- comped agencies are exempt
  UPDATE agencies SET complimentary_until = today + 10 WHERE id = ag;
  BEGIN
    PERFORM _t015_as((SELECT id FROM auth.users WHERE email = 'x2-015@test.local'));
    SET LOCAL ROLE authenticated;
    SELECT accept_invite(v_code, 'X Two', true) INTO v_js;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  UPDATE agencies SET complimentary_until = NULL WHERE id = ag;
  DELETE FROM agency_invites WHERE agency_id = ag;
  DELETE FROM users WHERE email = 'x2-015@test.local';
  UPDATE users SET deactivated_at = now() WHERE id = a;

  -- ---------------------------------------------------------
  -- 5. Policy limit (tier limit lowered inside this transaction)
  -- ---------------------------------------------------------
  UPDATE subscription_tiers SET max_active_policies = 1 WHERE key = 'starter';
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    -- ag has 1 active policy (p1); a second is refused
    PERFORM _t015_expect(format(
      'INSERT INTO policies (agency_id, client_id, insurer_id, product_line_id, agent_id, policy_number, premium_amount, commission_rate, commission_basis, start_date, expiry_date, status)
       VALUES (%L, %L, %L, %L, %L, %L, 1000, 10, %L, %L, %L, %L)', ag, cl1, i1, pl, o, 'T015-P3', 'annual', today, today + 364, 'active'),
      'Your plan allows 1 active policies. Upgrade to add more.');
    -- reactivating an expired policy counts too
    PERFORM _t015_expect(format('UPDATE policies SET status = %L WHERE id = %L', 'active', p2),
      'Your plan allows 1 active policies. Upgrade to add more.');
    -- renewing replaces the old term (expired first), so it fits at the limit
    SELECT renew_policy(p1,
      jsonb_build_object('policy_number', 'T015-P1', 'insurer_id', i1, 'product_line_id', pl, 'premium_amount', 12000,
                         'commission_rate', 10, 'commission_basis', 'annual', 'start_date', today + 21, 'expiry_date', today + 385))
      INTO v_new;
    SELECT count(*) INTO n FROM policies WHERE agency_id = ag AND status IN ('active', 'pending');
    ASSERT n = 1, format('renew at limit: expected 1 active policy, got %s', n);
    -- an edit that does not change status is fine
    UPDATE policies SET premium_amount = 12500 WHERE id = v_new;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  -- comped: no limit
  UPDATE agencies SET complimentary_until = today + 10 WHERE id = ag;
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    UPDATE policies SET status = 'active' WHERE id = p2;
    UPDATE policies SET status = 'expired' WHERE id = p2;
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes
  UPDATE agencies SET complimentary_until = NULL WHERE id = ag;

  -- ---------------------------------------------------------
  -- 6. subscription_check_tier / subscription_usage
  -- ---------------------------------------------------------
  -- ag: 2 users (o, m), 1 active policy; starter limit now 1 policy, 3 members
  PERFORM subscription_check_tier(ag, 'starter');
  UPDATE users SET deactivated_at = NULL WHERE id = a;
  INSERT INTO users (id, agency_id, role, full_name, email) VALUES
    (inv, ag, 'agent', 'Invited One', 'inv-015@test.local');
  PERFORM _t015_expect(format('SELECT subscription_check_tier(%L, %L)', ag, 'starter'), 'Remove 1 members first');
  UPDATE users SET deactivated_at = now() WHERE id = a;
  DELETE FROM users WHERE id = inv;
  UPDATE policies SET status = 'active' WHERE id = p2;
  PERFORM _t015_expect(format('SELECT subscription_check_tier(%L, %L)', ag, 'starter'), 'Reduce active policies to 1 first');
  PERFORM subscription_check_tier(ag, 'growth');
  PERFORM _t015_expect(format('SELECT subscription_check_tier(%L, %L)', ag, 'gold'), 'Pick a plan');
  UPDATE policies SET status = 'expired' WHERE id = p2;

  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    SELECT subscription_usage(ag) INTO v_js;
    ASSERT v_js = jsonb_build_object('members', 2, 'pending_invites', 0, 'active_policies', 1),
      format('usage: %s', v_js);
    PERFORM _t015_as(ob);
    PERFORM _t015_expect(format('SELECT subscription_usage(%L)', ag), 'Only the owner can do that', '42501');
    PERFORM _t015_as(m);
    PERFORM _t015_expect(format('SELECT subscription_usage(%L)', ag), 'Only the owner can do that', '42501');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes

  -- ---------------------------------------------------------
  -- 7. Payments
  -- ---------------------------------------------------------
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    PERFORM _t015_expect(format('SELECT create_subscription_payment(%L, %L, 3, 21000)', ag, 'growth'), NULL, '42501');
    PERFORM _t015_expect(format('SELECT apply_subscription_payment(%L, %L, %L)', 'x', 'card', '{}'), NULL, '42501');
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes

  -- lapsed: extends from today
  UPDATE agencies SET subscription_tier = 'starter', paid_until = today - 10 WHERE id = ag;
  SELECT create_subscription_payment(ag, 'growth', 3, 21000) INTO pay;
  ASSERT (SELECT status FROM subscription_payments WHERE id = pay) = 'pending', 'payment pending';
  SELECT apply_subscription_payment(pay::text, 'mobile_money', '{"ok":true}'::jsonb) INTO v_bool;
  ASSERT v_bool, 'apply: first call true';
  ASSERT (SELECT paid_until FROM agencies WHERE id = ag) = today + interval '3 months', 'apply: lapsed extends from today';
  ASSERT (SELECT subscription_tier FROM agencies WHERE id = ag) = 'growth', 'apply: tier switched';
  ASSERT (SELECT (status, channel, paid_until_before, paid_until_after, paid_at IS NOT NULL, raw)
            FROM subscription_payments WHERE id = pay)
         = ('paid'::text, 'mobile_money'::text, today - 10, (today + interval '3 months')::date, true, '{"ok":true}'::jsonb), 'apply: payment row';
  -- replay: no change
  SELECT apply_subscription_payment(pay::text, 'mobile_money', '{}'::jsonb) INTO v_bool;
  ASSERT NOT v_bool, 'apply: replay false';
  ASSERT (SELECT paid_until FROM agencies WHERE id = ag) = today + interval '3 months', 'apply: replay did not move paid_until';

  -- active: extends from paid_until
  UPDATE agencies SET paid_until = today + 10 WHERE id = ag;
  SELECT create_subscription_payment(ag, 'growth', 1, 7000) INTO pay2;
  PERFORM apply_subscription_payment(pay2::text, 'card', '{}'::jsonb);
  ASSERT (SELECT paid_until FROM agencies WHERE id = ag) = (today + 10) + interval '1 month', 'apply: active extends from paid_until';

  -- upgrade only: tier changes, paid_until unchanged
  SELECT paid_until INTO v_date FROM agencies WHERE id = ag;
  SELECT create_subscription_payment(ag, 'enterprise', 0, 1234) INTO pay2;
  PERFORM apply_subscription_payment(pay2::text, 'card', '{}'::jsonb);
  ASSERT (SELECT (subscription_tier, paid_until) FROM agencies WHERE id = ag) = ('enterprise'::text, v_date), 'apply: upgrade keeps paid_until';

  -- unknown reference
  SELECT apply_subscription_payment('no-such-reference', 'card', '{}'::jsonb) INTO v_bool;
  ASSERT NOT v_bool, 'apply: unknown reference false';

  -- month-end clamp
  UPDATE agencies SET paid_until = DATE '2099-01-31' WHERE id = ag;
  SELECT create_subscription_payment(ag, 'enterprise', 1, 15000) INTO pay2;
  PERFORM apply_subscription_payment(pay2::text, 'card', '{}'::jsonb);
  ASSERT (SELECT paid_until FROM agencies WHERE id = ag) = DATE '2099-02-28', 'apply: month-end clamp';

  -- validation
  PERFORM _t015_expect(format('SELECT create_subscription_payment(%L, %L, 1, 100)', ag, 'gold'), 'Pick a plan');
  PERFORM _t015_expect(format('SELECT create_subscription_payment(%L, %L, 2, 100)', ag, 'growth'), 'Pick how many months');

  -- RLS on payments
  BEGIN
    PERFORM _t015_as(o);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM subscription_payments WHERE agency_id = ag;
    ASSERT n = 4, format('payments rls: owner sees 4, got %s', n);
    PERFORM _t015_expect(format('INSERT INTO subscription_payments (agency_id, tier, months, amount_kes, paystack_reference) VALUES (%L, %L, 1, 1, %L)', ag, 'growth', 'forged'), NULL, '42501');
    PERFORM _t015_expect(format('UPDATE subscription_payments SET status = %L WHERE id = %L', 'paid', pay), NULL, '42501');
    PERFORM _t015_as(m);
    SELECT count(*) INTO n FROM subscription_payments WHERE agency_id = ag;
    ASSERT n = 0, 'payments rls: manager sees none';
    PERFORM _t015_as(ob);
    SELECT count(*) INTO n FROM subscription_payments WHERE agency_id = ag;
    ASSERT n = 0, 'payments rls: other owner sees none';
    SELECT count(*) INTO n FROM subscription_tiers;
    ASSERT n = 4, 'tiers readable by authenticated';
    RESET ROLE;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);   -- fixture statements are system writes

  -- ---------------------------------------------------------
  -- 8. Migration data and cron
  -- ---------------------------------------------------------
  ASSERT (SELECT complimentary_until FROM agencies WHERE id = '00ca4ec4-7ca5-4f84-a9ef-ef8b6e3b006c') = DATE '2099-12-31',
    'demo agency comped';
  ASSERT (SELECT active FROM cron.job WHERE jobname = 'subscription_reminders_daily') = false, 'cron job exists and is inactive';

  -- grants: service-only RPCs not callable by authenticated (checked above via 42501)
  ASSERT NOT has_function_privilege('authenticated', 'public.apply_subscription_payment(text, text, jsonb)', 'EXECUTE'), 'grant: apply';
  ASSERT NOT has_function_privilege('authenticated', 'public.create_subscription_payment(uuid, text, integer, integer)', 'EXECUTE'), 'grant: create';
  ASSERT NOT has_function_privilege('anon', 'public.subscription_usage(uuid)', 'EXECUTE'), 'grant: usage anon';
  ASSERT NOT has_function_privilege('anon', 'public.subscription_check_tier(uuid, text)', 'EXECUTE'), 'grant: check anon';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_agency_with_owner' AND pronargs = 3), 'old create_agency_with_owner dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'accept_invite' AND pronargs = 2), 'old accept_invite dropped';
END;
$$;

SELECT 'ALL PASSED' AS result;

ROLLBACK;
