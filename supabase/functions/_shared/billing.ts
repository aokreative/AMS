// Pure billing helpers shared by the Edge Functions (Deno) and the web app
// (Vite/Vitest). No runtime-specific globals beyond WebCrypto.

export interface Tier {
  key: string;
  name: string;
  price_kes: number;
  max_members: number | null;
  max_active_policies: number | null;
  sort_order: number;
}

/** Months an Owner may pay for at once. (0 is allowed only as an upgrade-only payment.) */
export const ALLOWED_MONTHS = [1, 3, 6, 12] as const;

/** Whole days from a to b (both 'yyyy-MM-dd'); positive when b is later. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * What the Owner pays: the pro-rated difference for the rest of the paid
 * period when moving to a dearer tier while still paid up, plus `months`
 * at the new tier's price. Throws 'Pick a plan' / 'Pick how many months'.
 */
export function paymentAmountKes(
  tiers: Tier[],
  currentTier: string,
  newTier: string,
  months: number,
  paidUntil: string | null,
  today: string,
): { difference: number; months: number; total: number } {
  const next = tiers.find((t) => t.key === newTier);
  if (!next) throw new Error('Pick a plan');
  const cur = tiers.find((t) => t.key === currentTier);

  let difference = 0;
  if (cur && next.price_kes > cur.price_kes && paidUntil && paidUntil >= today) {
    const remainingDays = daysBetween(today, paidUntil) + 1;
    difference = Math.ceil(((next.price_kes - cur.price_kes) * remainingDays) / 30);
  }

  const monthsOk = (ALLOWED_MONTHS as readonly number[]).includes(months) || (months === 0 && difference > 0);
  if (!monthsOk) throw new Error('Pick how many months');

  const monthsPart = months * next.price_kes;
  return { difference, months: monthsPart, total: difference + monthsPart };
}

/** Paystack webhook check: hex HMAC-SHA512 of the raw body with the secret key. */
export async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/**
 * What to do with a Paystack transaction status on verify. Only 'success'
 * applies and only 'failed' fails; 'abandoned' / 'ongoing' / 'pending' can
 * still complete (an unanswered M-Pesa prompt), so keep waiting.
 */
export function verifyOutcome(status: string | null | undefined): 'apply' | 'fail' | 'wait' {
  if (status === 'success') return 'apply';
  if (status === 'failed') return 'fail';
  return 'wait';
}

/** Today's date in Nairobi as 'yyyy-MM-dd'. */
export function todayNairobi(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
}
