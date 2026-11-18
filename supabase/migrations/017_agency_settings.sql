-- ============================================================
-- 017: agency language and currency are set in Settings, by an Owner
--   - set_agency_currency / set_agency_language (Owner only)
--   - agency_setting_changes: every change (old → new, who, when) so a
--     mistaken change can be switched back exactly. Amounts are never
--     converted or rewritten; the currency is only the label.
--   - the setup wizard keeps using complete_agency_setup
-- ============================================================

CREATE TABLE IF NOT EXISTS agency_setting_changes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  setting    TEXT NOT NULL CHECK (setting IN ('currency', 'language')),
  old_value  TEXT NOT NULL,
  new_value  TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_setting_changes_agency ON agency_setting_changes(agency_id, changed_at DESC);

ALTER TABLE agency_setting_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_setting_changes_owner_select ON agency_setting_changes;
CREATE POLICY agency_setting_changes_owner_select ON agency_setting_changes FOR SELECT TO authenticated
  USING (agency_id = public.current_user_agency_id() AND public.current_user_role() = 'owner');
REVOKE INSERT, UPDATE, DELETE ON agency_setting_changes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_agency_currency(p_currency TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency UUID := public.current_user_agency_id();
  v_old    TEXT;
BEGIN
  IF v_agency IS NULL OR public.current_user_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('KES', 'TZS', 'UGX', 'USD') THEN
    RAISE EXCEPTION 'Pick a currency';
  END IF;
  SELECT currency INTO v_old FROM agencies WHERE id = v_agency FOR UPDATE;
  IF v_old = p_currency THEN
    RETURN;
  END IF;
  UPDATE agencies SET currency = p_currency WHERE id = v_agency;
  INSERT INTO agency_setting_changes (agency_id, setting, old_value, new_value, changed_by)
  VALUES (v_agency, 'currency', v_old, p_currency, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_agency_currency(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_agency_currency(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_agency_language(p_language TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency UUID := public.current_user_agency_id();
  v_old    TEXT;
BEGIN
  IF v_agency IS NULL OR public.current_user_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can do that' USING ERRCODE = '42501';
  END IF;
  IF p_language IS NULL OR p_language NOT IN ('en', 'sw', 'fr', 'pt', 'es', 'ar') THEN
    RAISE EXCEPTION 'Pick a language';
  END IF;
  SELECT language INTO v_old FROM agencies WHERE id = v_agency FOR UPDATE;
  IF v_old = p_language THEN
    RETURN;
  END IF;
  UPDATE agencies SET language = p_language WHERE id = v_agency;
  INSERT INTO agency_setting_changes (agency_id, setting, old_value, new_value, changed_by)
  VALUES (v_agency, 'language', v_old, p_language, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_agency_language(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_agency_language(TEXT) TO authenticated;
