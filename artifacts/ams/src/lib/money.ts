export type CurrencyCode = 'KES' | 'TZS' | 'UGX' | 'USD';

export const CURRENCIES: { code: CurrencyCode; name: string; country: string }[] = [
  { code: 'KES', name: 'Kenyan shilling', country: 'Kenya' },
  { code: 'TZS', name: 'Tanzanian shilling', country: 'Tanzania' },
  { code: 'UGX', name: 'Ugandan shilling', country: 'Uganda' },
  { code: 'USD', name: 'US dollar', country: 'International' },
];

// The signed-in agency's working currency. AuthContext sets it when the
// agency loads, so every formatCurrency call shows the right code.
let current: CurrencyCode = 'KES';

export function setCurrency(code: CurrencyCode | null | undefined): void {
  current = CURRENCIES.some((c) => c.code === code) ? (code as CurrencyCode) : 'KES';
}

export function getCurrency(): CurrencyCode {
  return current;
}

/** e.g. "KES 15,000", "USD 1,234.50". Shillings show whole units; dollars show cents. */
export function formatMoney(amount: number | null | undefined, code: CurrencyCode = current): string {
  const n = Number(amount ?? 0);
  const digits = code === 'USD' ? 2 : 0;
  return `${code} ${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
