import { describe, expect, it } from 'vitest';
import { fromKes } from './fx';

const rates = { KES: 1, USD: 129, TZS: 0.05, UGX: 0.035 };

describe('fromKes', () => {
  it('KES stays as it is', () => {
    expect(fromKes(3500, 'KES', rates)).toBe(3500);
  });
  it('USD rounds to whole dollars for a price', () => {
    expect(fromKes(3500, 'USD', rates)).toBe(27);
    expect(fromKes(30000, 'USD', rates)).toBe(233);
  });
  it('TZS and UGX round to the nearest 100', () => {
    expect(fromKes(3500, 'TZS', rates)).toBe(70000);
    expect(fromKes(3500, 'UGX', rates)).toBe(100000);
    expect(fromKes(7000, 'UGX', rates)).toBe(200000);
  });
  it('no rate: no conversion (null)', () => {
    expect(fromKes(3500, 'USD', { KES: 1 })).toBeNull();
  });
});
