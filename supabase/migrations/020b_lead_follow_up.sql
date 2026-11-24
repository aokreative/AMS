-- ============================================================
-- 020b: set (or clear) a lead's next follow-up date without logging
-- a contact, for the quick "Today / Tomorrow / In 3 days / Next week"
-- buttons on the leads screen.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_lead_follow_up(p_lead_id UUID, p_date DATE)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v leads := public._lead_for_update(p_lead_id);
BEGIN
  IF v.stage IN ('paid', 'lost') THEN RAISE EXCEPTION 'This lead is closed. Reopen it first.'; END IF;
  IF p_date IS NOT NULL AND p_date < (now() AT TIME ZONE 'Africa/Nairobi')::date THEN
    RAISE EXCEPTION 'Pick today or a later date';
  END IF;
  UPDATE leads SET next_follow_up = p_date, updated_at = now() WHERE id = v.id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.set_lead_follow_up(UUID, DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_lead_follow_up(UUID, DATE) TO authenticated;
