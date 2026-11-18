-- ============================================================
-- 019c: demo review fixes
--   #1 The demo is marked by its id, never by a (customer-chosen) name.
--   #2 People who joined the demo during a session are switched off on
--      reset; the superadmin's seat is switched off on leaving and back
--      on when opening, under a neutral email.
--   #4 The reset copes with schema changes: the table list comes from
--      the catalog (every public table with agency_id except users,
--      subscription_payments, admin_actions), columns are those shared
--      by the live table and the saved copy, and a table with no saved
--      copy stops the reset with a clear message.
--   #5 No DDL in the reset: every table trigger gets a WHEN guard that
--      steps aside while the transaction-local ams.demo_restore is on,
--      so only the demo's own rows are locked.
-- ============================================================

-- #1 ----------------------------------------------------------
UPDATE agencies SET is_demo = (id = '00ca4ec4-7ca5-4f84-a9ef-ef8b6e3b006c');

-- #5: guard every table trigger in public -----------------------
DO $$
DECLARE
  r RECORD;
  def TEXT;
  guard CONSTANT TEXT := $g$(current_setting('ams.demo_restore'::text, true) IS DISTINCT FROM 'on'::text)$g$;
BEGIN
  FOR r IN
    SELECT tg.oid, tg.tgname, c.relname
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND NOT tg.tgisinternal
  LOOP
    def := pg_get_triggerdef(r.oid);
    CONTINUE WHEN def LIKE '%ams.demo_restore%';
    IF def LIKE '% WHEN (%' THEN
      def := replace(def, ' WHEN (', ' WHEN (' || guard || ' AND ');
    ELSE
      def := replace(def, ' EXECUTE FUNCTION ', ' WHEN ' || guard || ' EXECUTE FUNCTION ');
    END IF;
    EXECUTE format('DROP TRIGGER %I ON public.%I', r.tgname, r.relname);
    EXECUTE def;
  END LOOP;
END $$;

-- #4 ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._demo_tables()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname NOT IN ('users', 'subscription_payments', 'admin_actions')
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'agency_id' AND NOT a.attisdropped);
$$;
REVOKE EXECUTE ON FUNCTION public._demo_tables() FROM PUBLIC, anon, authenticated;

-- Writable columns shared by public.<table> and demo_snapshot.<table>.
CREATE OR REPLACE FUNCTION public._demo_columns(p_table TEXT, p_except TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    FROM pg_attribute a
   WHERE a.attrelid = format('public.%I', p_table)::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND a.attname IS DISTINCT FROM p_except
     AND EXISTS (SELECT 1 FROM pg_attribute s
                  WHERE s.attrelid = to_regclass(format('demo_snapshot.%I', p_table))
                    AND s.attname = a.attname AND NOT s.attisdropped);
$$;
REVOKE EXECUTE ON FUNCTION public._demo_columns(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._demo_restore()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
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
    IF to_regclass(format('demo_snapshot.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'The demo copy is out of date (no saved %). Save the demo copy again.', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND NOT tg.tgisinternal
                AND pg_get_triggerdef(tg.oid) NOT LIKE '%ams.demo_restore%') THEN
    RAISE EXCEPTION 'A table trigger is missing the demo-reset guard';
  END IF;

  -- One reset at a time.
  PERFORM pg_advisory_xact_lock(hashtext('ams.demo_restore'));
  PERFORM set_config('ams.demo_restore', 'on', true);

  FOR i IN REVERSE cardinality(v_order) .. 1 LOOP
    EXECUTE format('DELETE FROM public.%I WHERE agency_id = %L', v_order[i], v_demo);
  END LOOP;

  cols := public._demo_columns('agencies', 'id');
  EXECUTE format('UPDATE public.agencies a SET (%s) = (SELECT %s FROM demo_snapshot.agencies s WHERE s.id = a.id) WHERE a.id = %L',
                 cols, cols, v_demo);

  cols := public._demo_columns('users', 'id');
  EXECUTE format('UPDATE public.users u SET (%s) = (SELECT %s FROM demo_snapshot.users s WHERE s.id = u.id)
                   WHERE u.id IN (SELECT id FROM demo_snapshot.users)', cols, cols);
  -- Anyone who joined during a session is switched off (superadmin seats are handled by open/leave).
  UPDATE public.users SET deactivated_at = now()
   WHERE agency_id = v_demo AND deactivated_at IS NULL
     AND id NOT IN (SELECT id FROM demo_snapshot.users)
     AND id NOT IN (SELECT user_id FROM platform_admins);

  FOREACH t IN ARRAY v_order LOOP
    cols := public._demo_columns(t);
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM demo_snapshot.%I', t, cols, cols, t);
  END LOOP;

  PERFORM set_config('ams.demo_restore', 'off', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._demo_restore() FROM PUBLIC, anon, authenticated;

-- #2 ----------------------------------------------------------
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

  PERFORM public._demo_restore();

  IF v_found THEN
    UPDATE users SET role = 'owner', deactivated_at = NULL WHERE id = auth.uid();
  ELSE
    INSERT INTO users (id, agency_id, role, full_name, email)
    VALUES (auth.uid(), v_demo, 'owner', 'Superadmin (demo)', 'superadmin@demo.ams');
  END IF;
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
  UPDATE users SET deactivated_at = now()
   WHERE id = auth.uid() AND agency_id = public._demo_agency_id() AND deactivated_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_leave_demo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_leave_demo() TO authenticated;
