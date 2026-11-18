import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';

describe('buildCsv', () => {
  it('starts with the currency the amounts are in', () => {
    const lines = buildCsv([{ name: 'Jane', premium: 15000 }], undefined, 'UGX').split('\n');
    expect(lines[0]).toBe('Currency: UGX');
    expect(lines[1]).toBe('name,premium');
    expect(lines[2]).toBe('Jane,15000');
  });
  it('keeps column labels and quoting', () => {
    const csv = buildCsv([{ client: { name: 'A, B' } }], [{ key: 'client.name', label: 'Client' }], 'KES');
    expect(csv.split('\n')).toEqual(['Currency: KES', 'Client', '"A, B"']);
  });
});
