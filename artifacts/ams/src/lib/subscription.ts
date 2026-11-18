import type { Tier } from '../../../../supabase/functions/_shared/billing';
export { paymentAmountKes, todayNairobi, withCustomPrice, ALLOWED_MONTHS, type Tier } from '../../../../supabase/functions/_shared/billing';

/** Display copy of subscription_tiers (the database is the authority; the test pins both). */
export const TIERS: Tier[] = [
  { key: 'starter', name: 'Starter', price_kes: 3500, max_members: 3, max_active_policies: 300, sort_order: 1 },
  { key: 'growth', name: 'Growth', price_kes: 7000, max_members: 10, max_active_policies: null, sort_order: 2 },
  { key: 'enterprise', name: 'Enterprise', price_kes: 15000, max_members: 25, max_active_policies: null, sort_order: 3 },
  { key: 'enterprise_plus', name: 'Enterprise Plus', price_kes: 30000, max_members: null, max_active_policies: null, sort_order: 4 },
];

/** Owners allowed per plan (mirror of subscription_tiers.max_owners; null = unlimited). */
export const OWNERS: Record<string, number | null> = { starter: 1, growth: 2, enterprise: 3, enterprise_plus: null };

/** active / grace (3 days, full access) / locked: pay to access. */
export type AccessState = 'active' | 'grace' | 'locked';

interface SubscriptionDates {
  paid_until: string | null;
  complimentary_until: string | null;
}

export const GRACE_DAYS = 3;

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Mirror of SQL agency_access() for display; the database enforces. */
export function agencyAccess(a: SubscriptionDates, today: string): AccessState {
  if (a.complimentary_until && a.complimentary_until >= today) return 'active';
  if (a.paid_until && a.paid_until >= today) return 'active';
  if (a.paid_until && dayDiff(a.paid_until, today) <= GRACE_DAYS) return 'grace';
  return 'locked';
}

/** Days from today to paid_until (negative once past); null when comped or never paid. */
export function daysLeft(a: SubscriptionDates, today: string): number | null {
  if (a.complimentary_until && a.complimentary_until >= today) return null;
  if (!a.paid_until) return null;
  return dayDiff(today, a.paid_until);
}

export function formatKes(n: number): string {
  return `KES ${n.toLocaleString('en-US')}`;
}

export function tierName(key: string | null | undefined): string {
  return TIERS.find((t) => t.key === key)?.name ?? (key ?? '');
}

/** Owner places still free on the plan (null = unlimited). Pending owner invites take a place. */
export function ownerPlacesLeft(tier: string, comped: boolean, owners: number, pendingOwnerInvites: number): number | null {
  if (comped) return null;
  const max = OWNERS[tier];
  if (max == null) return null;
  return Math.max(0, max - owners - pendingOwnerInvites);
}

export type PlanGain = { kind: 'members' | 'owners' | 'policies'; value: number | null };

/** What a plan adds over the plan below it (null value = unlimited). Empty for the first plan. */
export function planGains(tier: string): PlanGain[] {
  const i = TIERS.findIndex((x) => x.key === tier);
  if (i <= 0) return [];
  const cur = TIERS[i];
  const prev = TIERS[i - 1];
  const out: PlanGain[] = [];
  if (cur.max_members !== prev.max_members) out.push({ kind: 'members', value: cur.max_members });
  if (OWNERS[cur.key] !== OWNERS[prev.key]) out.push({ kind: 'owners', value: OWNERS[cur.key] });
  if (cur.max_active_policies !== prev.max_active_policies) out.push({ kind: 'policies', value: cur.max_active_policies });
  return out;
}
