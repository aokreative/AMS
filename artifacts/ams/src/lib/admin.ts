import { GRACE_DAYS } from './subscription';

export type AdminStatus = 'suspended' | 'comped' | 'active' | 'grace' | 'unpaid';

export const ADMIN_STATUSES: AdminStatus[] = ['active', 'grace', 'unpaid', 'comped', 'suspended'];

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Same order as the database's _admin_rows(): suspended → comped → active → grace → unpaid. */
export function adminStatus(
  a: { paid_until: string | null; complimentary_until: string | null; suspended_at: string | null },
  today: string,
): AdminStatus {
  if (a.suspended_at) return 'suspended';
  if (a.complimentary_until && a.complimentary_until >= today) return 'comped';
  if (a.paid_until && a.paid_until >= today) return 'active';
  if (a.paid_until && addDays(a.paid_until, GRACE_DAYS) >= today) return 'grace';
  return 'unpaid';
}

export interface AdminOwner {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

/** Search over the agency name and its Owners' names and emails. */
export function matchesSearch(row: { name: string; owners: AdminOwner[] }, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [row.name, ...row.owners.flatMap((o) => [o.full_name, o.email])].some((v) => (v ?? '').toLowerCase().includes(s));
}

export interface AdminAgencyRow {
  id: string;
  name: string;
  status: AdminStatus;
  tier: string;
  price_kes: number;
  custom_price_kes: number | null;
  paid_until: string | null;
  complimentary_until: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  currency: string;
  created_at: string;
  members: number;
  active_policies: number;
  owners: AdminOwner[];
  last_paid_at: string | null;
  last_paid_kes: number | null;
}

export interface AdminOverview {
  counts: Record<AdminStatus | 'total', number>;
  expected_mrr_kes: number;
  revenue_this_month_kes: number;
}

export interface AdminDetail {
  payments: {
    id: string;
    tier: string;
    months: number;
    amount_kes: number;
    status: string;
    channel: string | null;
    created_at: string;
    paid_at: string | null;
    paid_until_after: string | null;
  }[];
  actions: {
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    note: string;
    created_at: string;
    admin_email: string | null;
  }[];
}

export type AdminRpc =
  | 'admin_suspend'
  | 'admin_reactivate'
  | 'admin_set_custom_price'
  | 'admin_set_comp'
  | 'admin_set_paid_until'
  | 'admin_set_tier';

/** A superadmin uses /admin, except while inside the resettable demo agency. */
export function adminBelongsOnAdminPage(isPlatformAdmin: boolean, inDemo: boolean): boolean {
  return isPlatformAdmin && !inDemo;
}

const DEMO_KEY = 'ams.inDemo';

/** Whether this browser tab is inside the demo (kept across reloads, cleared on leave/sign-out). */
export function readDemoFlag(): boolean {
  try {
    return sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDemoFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(DEMO_KEY, '1');
    else sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // ignore
  }
}
