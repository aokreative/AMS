import type { LeadStage } from './leads';

export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

export interface Notice {
  id: string;
  kind: 'follow_up' | 'renewal';
  title: string;
  detail: string | null;
  date: string;
  urgency: Urgency;
  href: string;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** How pressing a date is: overdue, today, within 3 days, or later. */
export function urgency(date: string, today: string): Urgency {
  const d = daysBetween(today, date);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return 'later';
}

/**
 * Follow-ups (open leads with a date) and renewals due within 30 days,
 * nearest first, so whatever is overdue sits on top.
 */
export function buildNotifications(
  leads: { id: string; full_name: string; stage: LeadStage; next_follow_up: string | null; interest: string | null }[],
  renewals: { policy_id: string; client_name: string | null; policy_number: string | null; expiry_date: string }[],
  today: string,
): Notice[] {
  const out: Notice[] = [];
  for (const l of leads) {
    if (!l.next_follow_up || l.stage === 'paid' || l.stage === 'lost') continue;
    if (daysBetween(today, l.next_follow_up) > 30) continue;
    out.push({
      id: `lead:${l.id}`,
      kind: 'follow_up',
      title: `Follow up with ${l.full_name}`,
      detail: l.interest,
      date: l.next_follow_up,
      urgency: urgency(l.next_follow_up, today),
      href: '/leads',
    });
  }
  for (const r of renewals) {
    if (daysBetween(today, r.expiry_date) > 30) continue;
    out.push({
      id: `renewal:${r.policy_id}`,
      kind: 'renewal',
      title: `${r.client_name ?? 'A client'} renews`,
      detail: r.policy_number,
      date: r.expiry_date,
      urgency: urgency(r.expiry_date, today),
      href: '/renewals',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}
