import { describe, expect, it } from 'vitest';
import { buildNotifications, urgency } from './notifications';

const today = '2026-11-24';

describe('urgency', () => {
  it('overdue, today, soon (within 3 days), later', () => {
    expect(urgency('2026-11-20', today)).toBe('overdue');
    expect(urgency(today, today)).toBe('today');
    expect(urgency('2026-11-27', today)).toBe('soon');
    expect(urgency('2026-12-10', today)).toBe('later');
  });
});

describe('buildNotifications', () => {
  const leads = [
    { id: 'l1', full_name: 'Brian', stage: 'contacted' as const, next_follow_up: '2026-11-26', interest: 'Motor' },
    { id: 'l2', full_name: 'Grace', stage: 'quoted' as const, next_follow_up: '2026-11-22', interest: null },
    { id: 'l3', full_name: 'Closed', stage: 'paid' as const, next_follow_up: '2026-11-20', interest: null },
    { id: 'l4', full_name: 'Far off', stage: 'new' as const, next_follow_up: '2027-01-30', interest: null },
    { id: 'l5', full_name: 'No date', stage: 'new' as const, next_follow_up: null, interest: null },
  ];
  const renewals = [
    { policy_id: 'p1', client_name: 'Kilimo Ltd', policy_number: 'BRI/1', expiry_date: '2026-11-24' },
    { policy_id: 'p2', client_name: 'Otieno', policy_number: 'JUB/2', expiry_date: '2026-12-15' },
  ];

  it('merges follow-ups and renewals, nearest first, overdue on top', () => {
    const n = buildNotifications(leads, renewals, today);
    expect(n.map((x) => x.id)).toEqual(['lead:l2', 'renewal:p1', 'lead:l1', 'renewal:p2']);
    expect(n[0]).toMatchObject({ kind: 'follow_up', title: 'Follow up with Grace', urgency: 'overdue', href: '/leads?lead=l2' });
    expect(n[1]).toMatchObject({ kind: 'renewal', title: 'Kilimo Ltd renews', urgency: 'today', href: '/renewals' });
  });

  it('skips closed leads, leads without a date and anything beyond 30 days', () => {
    const ids = buildNotifications(leads, renewals, today).map((x) => x.id);
    expect(ids).not.toContain('lead:l3');
    expect(ids).not.toContain('lead:l4');
    expect(ids).not.toContain('lead:l5');
  });

  it('the badge counts only what is overdue, today or within 3 days', () => {
    const n = buildNotifications(leads, renewals, today);
    expect(n.filter((x) => x.urgency !== 'later').length).toBe(3);
  });
});
