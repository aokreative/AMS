-- ============================================================
-- 019b: demo reset without session_replication_role (not permitted for
-- API callers on Supabase): switch off the tables' own triggers and
-- restore children-first / parents-first. 019 already contains this
-- final version; this file records the live fix.
-- ============================================================

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

