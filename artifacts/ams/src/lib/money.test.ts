import { afterEach, describe, expect, it } from 'vitest';
import { CURRENCIES, formatMoney, getCurrency, setCurrency } from './money';
import { formatCurrency } from './utils';

afterEach(() => setCurrency('KES'));

describe('formatMoney', () => {
  it('shows whole amounts with the currency code', () => {
    expect(formatMoney(15000, 'KES')).toBe('KES 15,000');
    expect(formatMoney(2500000, 'UGX')).toBe('UGX 2,500,000');
    expect(formatMoney(99999.6, 'TZS')).toBe('TZS 100,000');
  });
  it('shows cents for USD', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('USD 1,234.50');
  });
  it('treats missing amounts as zero', () => {
    expect(formatMoney(null, 'KES')).toBe('KES 0');
  });
});

describe('agency currency', () => {
  it('defaults to KES and formatCurrency follows the agency currency', () => {
    expect(getCurrency()).toBe('KES');
    expect(formatCurrency(15000)).toBe('KES 15,000');
    setCurrency('UGX');
    expect(formatCurrency(15000)).toBe('UGX 15,000');
  });
  it('ignores unknown codes', () => {
    setCurrency('EUR' as never);
    expect(getCurrency()).toBe('KES');
  });
  it('offers the four supported currencies', () => {
    expect(CURRENCIES.map((c) => c.code)).toEqual(['KES', 'TZS', 'UGX', 'USD']);
  });
});
