import { describe, expect, it } from 'vitest';
import { agencyAccess, daysLeft, formatKes, OWNERS, TIERS } from './subscription';

const today = '2026-11-15';
const ag = (paid_until: string | null, complimentary_until: string | null = null) => ({ paid_until, complimentary_until });

describe('TIERS mirrors subscription_tiers', () => {
  it('has the four agreed plans', () => {
    expect(TIERS.map((t) => [t.key, t.name, t.price_kes, t.max_members, t.max_active_policies])).toEqual([
      ['starter', 'Starter', 3500, 3, 300],
      ['growth', 'Growth', 7000, 10, null],
      ['enterprise', 'Enterprise', 15000, 25, null],
      ['enterprise_plus', 'Enterprise Plus', 30000, null, null],
    ]);
  });
});

describe('OWNERS mirrors max_owners', () => {
  it('1 / 2 / 3 / unlimited', () => {
    expect(TIERS.map((t) => OWNERS[t.key])).toEqual([1, 2, 3, null]);
  });
});

describe('agencyAccess', () => {
  it('active while paid up, including the last day', () => {
    expect(agencyAccess(ag('2026-11-20'), today)).toBe('active');
    expect(agencyAccess(ag(today), today)).toBe('active');
  });
  it('grace for 3 days after', () => {
    expect(agencyAccess(ag('2026-11-12'), today)).toBe('grace');
  });
  it('read-only from day 4, and before any payment', () => {
    expect(agencyAccess(ag('2026-11-11'), today)).toBe('read_only');
    expect(agencyAccess(ag(null), today)).toBe('read_only');
  });
  it('comped agencies are active', () => {
    expect(agencyAccess(ag(null, today), today)).toBe('active');
  });
});

describe('daysLeft', () => {
  it('counts days to paid_until', () => {
    expect(daysLeft(ag('2026-11-20'), today)).toBe(5);
    expect(daysLeft(ag('2026-11-12'), today)).toBe(-3);
  });
  it('null when comped or never paid', () => {
    expect(daysLeft(ag('2026-11-20', '2099-12-31'), today)).toBeNull();
    expect(daysLeft(ag(null), today)).toBeNull();
  });
});

describe('formatKes', () => {
  it('formats whole shillings', () => {
    expect(formatKes(22750)).toBe('KES 22,750');
  });
});
