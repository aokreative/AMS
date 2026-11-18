-- ============================================================
-- 018a: superadmin review fixes
--   #1 A custom price belongs to the plan it was given for: any plan
--      change (a paid upgrade or admin_set_tier) clears it, so a
--      discount on Starter never carries over to a dearer plan.
--   #2 Suspension now blocks every write by the agency's members,
--      including the paths the 015 trigger loop never covered: the
--      agency profile and settings (agencies), member records (users),
--      the settings history (agency_setting_changes) and receipt files.
--      Superadmins and the service role are unaffected.
-- ============================================================

-- #1 ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clear_custom_price_on_tier_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     AND NEW.custom_price_kes IS NOT DISTINCT FROM OLD.custom_price_kes THEN
    NEW.custom_price_kes := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._clear_custom_price_on_tier_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agencies_clear_custom_price ON agencies;
CREATE TRIGGER agencies_clear_custom_price
  BEFORE UPDATE OF subscription_tier ON agencies
  FOR EACH ROW EXECUTE FUNCTION public._clear_custom_price_on_tier_change();

-- #2 ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._agency_is_suspended(p_agency_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM agencies WHERE id = p_agency_id AND suspended_at IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION public._agency_is_suspended(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._agency_is_suspended(UUID) TO authenticated;   -- used in storage policies

-- Refuses a write by an API user (not a superadmin) to a suspended agency.
-- The agency is NEW/OLD.agency_id, or the row's own id on agencies.
CREATE OR REPLACE FUNCTION public.block_suspended_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims JSONB := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_agency UUID;
BEGIN
  IF coalesce(v_claims->>'role', '') <> 'authenticated' OR public.is_platform_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'agencies' THEN
    v_agency := COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(OLD)->>'id')::uuid);
  ELSE
    v_agency := COALESCE((to_jsonb(NEW)->>'agency_id')::uuid, (to_jsonb(OLD)->>'agency_id')::uuid);
  END IF;
  IF v_agency IS NOT NULL AND public._agency_is_suspended(v_agency) THEN
    RAISE EXCEPTION 'This account is suspended'
      USING ERRCODE = 'P0001', HINT = 'account_suspended';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.block_suspended_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agencies_block_suspended ON agencies;
CREATE TRIGGER agencies_block_suspended
  BEFORE UPDATE OR DELETE ON agencies
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_writes();

DROP TRIGGER IF EXISTS users_block_suspended ON users;
CREATE TRIGGER users_block_suspended
  BEFORE INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_writes();

DROP TRIGGER IF EXISTS agency_setting_changes_block_suspended ON agency_setting_changes;
CREATE TRIGGER agency_setting_changes_block_suspended
  BEFORE INSERT OR UPDATE OR DELETE ON agency_setting_changes
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_writes();

-- Receipt files: no uploads or deletes while suspended (reading stays allowed).
DROP POLICY IF EXISTS receipts_owner_manager_insert ON storage.objects;
CREATE POLICY receipts_owner_manager_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts'
              AND (storage.foldername(name))[1] = public.current_user_agency_id()::text
              AND public.is_owner_or_manager()
              AND NOT public._agency_is_suspended(public.current_user_agency_id()));

DROP POLICY IF EXISTS receipts_owner_manager_delete ON storage.objects;
CREATE POLICY receipts_owner_manager_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receipts'
         AND (storage.foldername(name))[1] = public.current_user_agency_id()::text
         AND public.is_owner_or_manager()
         AND NOT public._agency_is_suspended(public.current_user_agency_id()));
