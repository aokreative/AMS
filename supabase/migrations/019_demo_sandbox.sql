-- ============================================================
-- 019: resettable demo agency for superadmins
--   * agencies.is_demo marks the one demo agency.
--   * demo_snapshot.* holds a saved copy of its data (private schema).
--   * admin_open_demo(): gives the calling superadmin an Owner seat in
--     the demo agency and resets the demo to the saved copy.
--   * admin_leave_demo(): resets the demo to the saved copy again.
--   Everything works normally while inside the demo; nothing survives
--   leaving (or the next open). Paystack refuses demo payments.
-- ============================================================

ALTER TABLE agencies ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS agencies_one_demo ON agencies (is_demo) WHERE is_demo;
UPDATE agencies SET is_demo = true WHERE name = 'Demo Insurance Agency';

CREATE SCHEMA IF NOT EXISTS demo_snapshot;
REVOKE ALL ON SCHEMA demo_snapshot FROM PUBLIC, anon, authenticated;

-- Tables whose rows belong to an agency (agency_id) and are reset.
CREATE OR REPLACE FUNCTION public._demo_tables()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'agency_invites', 'agency_setting_changes', 'agent_earnings', 'agent_payouts', 'agent_rates',
    'clients', 'commission_allocations', 'commission_transactions', 'insurer_receipts', 'insurers',
    'policies', 'policy_renewals', 'product_lines', 'renewal_activities', 'renewal_reminders',
    'reports', 'statement_lines'
  ];
$$;
REVOKE EXECUTE ON FUNCTION public._demo_tables() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demo_agency_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM agencies WHERE is_demo;
$$;
REVOKE EXECUTE ON FUNCTION public._demo_agency_id() FROM PUBLIC, anon, authenticated;

-- Writable (non-generated) columns of a public table, quoted and comma-separated.
CREATE OR REPLACE FUNCTION public._demo_columns(p_table TEXT, p_except TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    FROM pg_attribute
   WHERE attrelid = format('public.%I', p_table)::regclass
     AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
     AND attname IS DISTINCT FROM p_except;
$$;
REVOKE EXECUTE ON FUNCTION public._demo_columns(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Save the demo agency's current data as the copy every reset returns to.
-- (Superadmins' own seats in the demo are never part of the copy.)
CREATE OR REPLACE FUNCTION public._demo_save_snapshot()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo UUID := public._demo_agency_id();
  t TEXT;
BEGIN
  IF v_demo IS NULL THEN RAISE EXCEPTION 'No demo agency'; END IF;
  FOREACH t IN ARRAY public._demo_tables() LOOP
    EXECUTE format('DROP TABLE IF EXISTS demo_snapshot.%I', t);
    EXECUTE format('CREATE TABLE demo_snapshot.%I AS SELECT * FROM public.%I WHERE agency_id = %L', t, t, v_demo);
  END LOOP;
  DROP TABLE IF EXISTS demo_snapshot.agencies;
  EXECUTE format('CREATE TABLE demo_snapshot.agencies AS SELECT * FROM public.agencies WHERE id = %L', v_demo);
  DROP TABLE IF EXISTS demo_snapshot.users;
  EXECUTE format('CREATE TABLE demo_snapshot.users AS SELECT * FROM public.users WHERE agency_id = %L
                    AND id NOT IN (SELECT user_id FROM platform_admins)', v_demo);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._demo_save_snapshot() FROM PUBLIC, anon, authenticated;

-- The demo tables ordered parents first (by their foreign keys between each other).
CREATE OR REPLACE FUNCTION public._demo_table_order()
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  todo TEXT[] := public._demo_tables();
  done TEXT[] := '{}';
  t TEXT;
  progressed BOOLEAN;
BEGIN
  WHILE cardinality(todo) > 0 LOOP
    progressed := false;
    FOREACH t IN ARRAY todo LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.conrelid = format('public.%I', t)::regclass
           AND c.confrelid <> c.conrelid
           AND (SELECT relname FROM pg_class WHERE oid = c.confrelid) = ANY (todo)
      ) THEN
        done := done || t;
        todo := array_remove(todo, t);
        progressed := true;
      END IF;
    END LOOP;
    IF NOT progressed THEN RAISE EXCEPTION 'Demo tables have a foreign-key cycle: %', todo; END IF;
  END LOOP;
  RETURN done;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._demo_table_order() FROM PUBLIC, anon, authenticated;

-- Put the demo agency back exactly as saved. The tables' own triggers are
-- switched off for the swap so derived rows (earnings, recomputed totals)
-- are restored as saved rather than generated again; foreign-key checks
-- stay on, so rows are removed children-first and put back parents-first.
CREATE OR REPLACE FUNCTION public._demo_restore()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo  UUID := public._demo_agency_id();
  v_order TEXT[] := public._demo_table_order();
  t TEXT;
  cols TEXT;
  i INTEGER;
BEGIN
  IF v_demo IS NULL THEN RAISE EXCEPTION 'No demo agency'; END IF;

  FOREACH t IN ARRAY v_order || ARRAY['agencies', 'users'] LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;

  FOR i IN REVERSE cardinality(v_order) .. 1 LOOP
    EXECUTE format('DELETE FROM public.%I WHERE agency_id = %L', v_order[i], v_demo);
  END LOOP;

  cols := public._demo_columns('agencies', 'id');
  EXECUTE format('UPDATE public.agencies a SET (%s) = (SELECT %s FROM demo_snapshot.agencies s WHERE s.id = a.id) WHERE a.id = %L',
                 cols, cols, v_demo);

  -- Demo members get their saved details back; superadmin seats are left alone.
  cols := public._demo_columns('users', 'id');
  EXECUTE format('UPDATE public.users u SET (%s) = (SELECT %s FROM demo_snapshot.users s WHERE s.id = u.id)
                   WHERE u.id IN (SELECT id FROM demo_snapshot.users)', cols, cols);

  FOREACH t IN ARRAY v_order LOOP
    cols := public._demo_columns(t);
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM demo_snapshot.%I', t, cols, cols, t);
  END LOOP;

  FOREACH t IN ARRAY v_order || ARRAY['agencies', 'users'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._demo_restore() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_open_demo()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo   UUID := public._demo_agency_id();
  v_agency UUID;
  v_found  BOOLEAN;
BEGIN
  PERFORM public._assert_platform_admin();
  IF v_demo IS NULL THEN RAISE EXCEPTION 'No demo agency'; END IF;

  SELECT agency_id, true INTO v_agency, v_found FROM users WHERE id = auth.uid();
  IF v_found AND v_agency IS DISTINCT FROM v_demo THEN
    RAISE EXCEPTION 'This superadmin account belongs to an agency';
  END IF;

  IF v_found THEN
    UPDATE users SET role = 'owner', deactivated_at = NULL WHERE id = auth.uid();
  ELSE
    INSERT INTO users (id, agency_id, role, full_name, email)
    SELECT auth.uid(), v_demo, 'owner', 'Superadmin (demo)', au.email FROM auth.users au WHERE au.id = auth.uid();
  END IF;

  PERFORM public._demo_restore();
  RETURN v_demo;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_open_demo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_open_demo() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_leave_demo()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_platform_admin();
  PERFORM public._demo_restore();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_leave_demo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_leave_demo() TO authenticated;

-- Save the demo as it is today.
SELECT public._demo_save_snapshot();
