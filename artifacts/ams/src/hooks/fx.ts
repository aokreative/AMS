import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fromKes, type Rates } from '@/lib/fx';
import { getCurrency } from '@/lib/money';
import { formatKes } from '@/lib/subscription';

/** Exchange rates set by the superadmin (KES per unit of each currency). */
export function useExchangeRates() {
  return useQuery({
    queryKey: ['exchange-rates'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('exchange_rates').select('currency, kes_per_unit');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.currency, Number(r.kes_per_unit)])) as Rates;
    },
  });
}

/**
 * Formats plan prices for the agency: in its own currency ("≈ USD 27") with the
 * KES charge alongside, or plain KES for KES agencies.
 */
export function usePlanPrice(currencyOverride?: string) {
  const { data: rates } = useExchangeRates();
  const currency = currencyOverride ?? getCurrency();
  const local = (kes: number): string | null => {
    if (currency === 'KES' || !rates) return null;
    const v = fromKes(kes, currency, rates);
    return v == null ? null : `≈ ${currency} ${v.toLocaleString('en-US')}`;
  };
  /** Main price text: local approximation if there is one, else KES. */
  const main = (kes: number) => local(kes) ?? formatKes(kes);
  /** Secondary text: the KES charge, only when a local approximation is shown. */
  const charged = (kes: number) => (local(kes) ? formatKes(kes) : null);
  return { currency, main, charged, local, isLocal: currency !== 'KES' && !!rates };
}
