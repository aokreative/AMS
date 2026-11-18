import { describe, expect, it } from 'vitest';
import { agencyAccess, daysLeft, formatKes, ownerPlacesLeft, OWNERS, paymentAmountKes, planGains, TIERS, withCustomPrice } from './subscription';

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
  it('locked (pay to access) from day 4, and before any payment', () => {
    expect(agencyAccess(ag('2026-11-11'), today)).toBe('locked');
    expect(agencyAccess(ag(null), today)).toBe('locked');
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

describe('ownerPlacesLeft', () => {
  it('counts owners and pending owner invites against the plan', () => {
    expect(ownerPlacesLeft('growth', false, 1, 0)).toBe(1);
    expect(ownerPlacesLeft('growth', false, 1, 1)).toBe(0);
    expect(ownerPlacesLeft('starter', false, 1, 0)).toBe(0);
  });
  it('unlimited on Enterprise Plus and for comped agencies', () => {
    expect(ownerPlacesLeft('enterprise_plus', false, 9, 0)).toBeNull();
    expect(ownerPlacesLeft('starter', true, 1, 0)).toBeNull();
  });
});

describe('planGains', () => {
  it('Starter is the base plan: nothing to compare', () => {
    expect(planGains('starter')).toEqual([]);
  });
  it('Growth adds members, an owner and unlimited policies over Starter', () => {
    expect(planGains('growth')).toEqual([
      { kind: 'members', value: 10 },
      { kind: 'owners', value: 2 },
      { kind: 'policies', value: null },
    ]);
  });
  it('Enterprise adds members and an owner over Growth (policies already unlimited)', () => {
    expect(planGains('enterprise')).toEqual([
      { kind: 'members', value: 25 },
      { kind: 'owners', value: 3 },
    ]);
  });
  it('Enterprise Plus makes members and owners unlimited', () => {
    expect(planGains('enterprise_plus')).toEqual([
      { kind: 'members', value: null },
      { kind: 'owners', value: null },
    ]);
  });
});

describe('withCustomPrice', () => {
  it('no custom price: prices unchanged', () => {
    expect(withCustomPrice(TIERS, 'starter', null).map((x) => x.price_kes)).toEqual([3500, 7000, 15000, 30000]);
  });
  it('replaces only the current plan price', () => {
    expect(withCustomPrice(TIERS, 'starter', 2500).map((x) => x.price_kes)).toEqual([2500, 7000, 15000, 30000]);
    expect(TIERS[0].price_kes).toBe(3500);
  });
  it('is what a renewal charges', () => {
    expect(paymentAmountKes(withCustomPrice(TIERS, 'starter', 2500), 'starter', 'starter', 3, null, '2026-11-18').total).toBe(7500);
  });
  it('an upgrade while paid up is measured from the custom price', () => {
    // 30 days left (inclusive): (7000 - 2500) * 30 / 30 = 4500 difference + 1 month of Growth
    const a = paymentAmountKes(withCustomPrice(TIERS, 'starter', 2500), 'starter', 'growth', 1, '2026-12-17', '2026-11-18');
    expect(a).toEqual({ difference: 4500, months: 7000, total: 11500 });
  });
});
