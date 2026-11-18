import { describe, expect, it } from 'vitest';
import { adminBelongsOnAdminPage, adminStatus, matchesSearch } from './admin';

const today = '2026-11-18';
const a = (o: Partial<{ paid_until: string | null; complimentary_until: string | null; suspended_at: string | null }>) => ({
  paid_until: null,
  complimentary_until: null,
  suspended_at: null,
  ...o,
});

describe('adminStatus', () => {
  it('suspended beats everything, even free time', () => {
    expect(adminStatus(a({ suspended_at: '2026-11-01T00:00:00Z', complimentary_until: '2099-12-31' }), today)).toBe('suspended');
  });
  it('comped while free time lasts', () => {
    expect(adminStatus(a({ complimentary_until: today }), today)).toBe('comped');
  });
  it('active while paid up', () => {
    expect(adminStatus(a({ paid_until: today }), today)).toBe('active');
  });
  it('grace for 3 days after', () => {
    expect(adminStatus(a({ paid_until: '2026-11-15' }), today)).toBe('grace');
  });
  it('unpaid after grace or before any payment', () => {
    expect(adminStatus(a({ paid_until: '2026-11-14' }), today)).toBe('unpaid');
    expect(adminStatus(a({}), today)).toBe('unpaid');
  });
});

describe('matchesSearch', () => {
  const row = { name: 'Andy Insurance', owners: [{ full_name: 'Jane Kamau', email: 'jane@andy.co.ke', phone: null }] };
  it('matches agency name, owner name or email, ignoring case', () => {
    expect(matchesSearch(row, 'andy')).toBe(true);
    expect(matchesSearch(row, 'KAMAU')).toBe(true);
    expect(matchesSearch(row, 'jane@')).toBe(true);
    expect(matchesSearch(row, 'britam')).toBe(false);
  });
  it('an empty search matches everything', () => {
    expect(matchesSearch(row, '  ')).toBe(true);
  });
});

describe('adminBelongsOnAdminPage', () => {
  it('a superadmin outside the demo always goes to /admin', () => {
    expect(adminBelongsOnAdminPage(true, false)).toBe(true);
  });
  it('inside the demo the superadmin uses the app', () => {
    expect(adminBelongsOnAdminPage(true, true)).toBe(false);
  });
  it('never for agency users', () => {
    expect(adminBelongsOnAdminPage(false, false)).toBe(false);
    expect(adminBelongsOnAdminPage(false, true)).toBe(false);
  });
});
