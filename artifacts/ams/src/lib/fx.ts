export type Rates = Partial<Record<'KES' | 'TZS' | 'UGX' | 'USD', number>>;

/**
 * A KES amount shown in another currency, rounded the way prices are quoted
 * there: whole dollars, the nearest 100 shillings for TZS/UGX. Null when there
 * is no rate. (Display only — payments are charged in KES.)
 */
export function fromKes(kes: number, currency: string, rates: Rates): number | null {
  if (currency === 'KES') return kes;
  const rate = rates[currency as keyof Rates];
  if (!rate || rate <= 0) return null;
  const v = kes / rate;
  if (currency === 'TZS' || currency === 'UGX') return Math.round(v / 100) * 100;
  return Math.round(v);
}
