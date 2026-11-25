-- ============================================================
-- 021: exchange rates for showing plan prices in an agency's own
-- currency. Payments are still charged in KES through Paystack; the
-- converted price is shown as "≈" with the KES charge alongside.
-- Rates are set by a superadmin; anyone may read them (the public
-- demo shows prices too).
-- ============================================================

CREATE TABLE IF NOT EXISTS exchange_rates (
  currency     TEXT PRIMARY KEY CHECK (currency IN ('KES', 'TZS', 'UGX', 'USD')),
  kes_per_unit NUMERIC(14,6) NOT NULL CHECK (kes_per_unit > 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Starting rates (Nov 2026, approximate): 1 USD ≈ 129 KES; 1 KES ≈ 20 TZS; 1 KES ≈ 28.6 UGX.
INSERT INTO exchange_rates (currency, kes_per_unit) VALUES
  ('KES', 1), ('USD', 129), ('TZS', 0.05), ('UGX', 0.035)
ON CONFLICT (currency) DO NOTHING;

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exchange_rates_read ON exchange_rates;
CREATE POLICY exchange_rates_read ON exchange_rates FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON exchange_rates FROM anon, authenticated;
GRANT SELECT ON exchange_rates TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_exchange_rate(p_currency TEXT, p_kes_per_unit NUMERIC)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_platform_admin();
  IF p_currency IS NULL OR p_currency NOT IN ('KES', 'TZS', 'UGX', 'USD') THEN RAISE EXCEPTION 'Pick a currency'; END IF;
  IF p_currency = 'KES' THEN RAISE EXCEPTION 'KES is always 1'; END IF;
  IF p_kes_per_unit IS NULL OR p_kes_per_unit = 'NaN'::numeric OR p_kes_per_unit <= 0 THEN
    RAISE EXCEPTION 'Enter a rate above 0';
  END IF;
  INSERT INTO exchange_rates (currency, kes_per_unit, updated_at, updated_by)
  VALUES (p_currency, p_kes_per_unit, now(), auth.uid())
  ON CONFLICT (currency) DO UPDATE SET kes_per_unit = EXCLUDED.kes_per_unit, updated_at = now(), updated_by = auth.uid();
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_set_exchange_rate(TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_exchange_rate(TEXT, NUMERIC) TO authenticated;
