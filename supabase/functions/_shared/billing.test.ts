import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALLOWED_MONTHS, paymentAmountKes, verifySignature, type Tier } from './billing';

const TIERS: Tier[] = [
  { key: 'starter', name: 'Starter', price_kes: 3500, max_members: 3, max_active_policies: 300, sort_order: 1 },
  { key: 'growth', name: 'Growth', price_kes: 7000, max_members: 10, max_active_policies: null, sort_order: 2 },
  { key: 'enterprise', name: 'Enterprise', price_kes: 15000, max_members: 25, max_active_policies: null, sort_order: 3 },
  { key: 'enterprise_plus', name: 'Enterprise Plus', price_kes: 30000, max_members: null, max_active_policies: null, sort_order: 4 },
];
const TODAY = '2026-11-15';

describe('paymentAmountKes', () => {
  it('upgrade only: difference for the days left (15 days, starter→growth)', () => {
    expect(paymentAmountKes(TIERS, 'starter', 'growth', 0, '2026-11-29', TODAY)).toEqual({ difference: 1750, months: 0, total: 1750 });
  });
  it('upgrade plus months', () => {
    expect(paymentAmountKes(TIERS, 'starter', 'growth', 3, '2026-11-29', TODAY)).toEqual({ difference: 1750, months: 21000, total: 22750 });
  });
  it('rounds the difference up to the shilling', () => {
    // 1 day left, growth→enterprise: 8000/30 = 266.67 → 267
    expect(paymentAmountKes(TIERS, 'growth', 'enterprise', 0, TODAY, TODAY).difference).toBe(267);
  });
  it('same tier: months only', () => {
    expect(paymentAmountKes(TIERS, 'growth', 'growth', 1, '2026-11-29', TODAY)).toEqual({ difference: 0, months: 7000, total: 7000 });
  });
  it('downgrade: no difference, new price', () => {
    expect(paymentAmountKes(TIERS, 'growth', 'starter', 1, '2026-11-29', TODAY)).toEqual({ difference: 0, months: 3500, total: 3500 });
  });
  it('lapsed agency upgrading pays no difference', () => {
    expect(paymentAmountKes(TIERS, 'starter', 'growth', 1, '2026-11-01', TODAY)).toEqual({ difference: 0, months: 7000, total: 7000 });
  });
  it('months 0 needs a real upgrade on an active plan', () => {
    expect(() => paymentAmountKes(TIERS, 'starter', 'growth', 0, null, TODAY)).toThrow('Pick how many months');
    expect(() => paymentAmountKes(TIERS, 'growth', 'growth', 0, '2026-11-29', TODAY)).toThrow('Pick how many months');
  });
  it('only 0, 1, 3, 6 or 12 months', () => {
    expect(ALLOWED_MONTHS).toEqual([1, 3, 6, 12]);
    expect(() => paymentAmountKes(TIERS, 'starter', 'growth', 2, null, TODAY)).toThrow('Pick how many months');
  });
  it('unknown tier', () => {
    expect(() => paymentAmountKes(TIERS, 'starter', 'gold', 1, null, TODAY)).toThrow('Pick a plan');
  });
});

describe('verifySignature', () => {
  const secret = 'sk_test_abc';
  const body = '{"event":"charge.success","data":{"reference":"r1"}}';
  const sig = createHmac('sha512', secret).update(body).digest('hex');
  it('accepts a valid signature', async () => {
    expect(await verifySignature(body, sig, secret)).toBe(true);
  });
  it('rejects a tampered body', async () => {
    expect(await verifySignature(body.replace('r1', 'r2'), sig, secret)).toBe(false);
  });
  it('rejects a missing signature', async () => {
    expect(await verifySignature(body, null, secret)).toBe(false);
  });
});
