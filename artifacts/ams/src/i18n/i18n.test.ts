import { describe, expect, it } from 'vitest';
import { LANGUAGES, resources, isRtl, normaliseLanguage } from './index';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  ).sort();
}

describe('translations', () => {
  it('offers English, Kiswahili, French, Portuguese, Spanish and Arabic', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'sw', 'fr', 'pt', 'es', 'ar']);
  });
  it('every language has the English keys (plural forms aside)', () => {
    const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '');
    const en = [...new Set(keys(resources.en.translation).map(base))];
    for (const { code } of LANGUAGES) {
      expect([...new Set(keys(resources[code].translation).map(base))], code).toEqual(en);
    }
  });
  it('every language has the plural forms its grammar needs for counts 0–30', () => {
    const plural = [...new Set(keys(resources.en.translation).filter((k) => /_(one|other)$/.test(k)).map((k) => k.replace(/_(one|other)$/, '')))];
    for (const { code } of LANGUAGES) {
      const have = new Set(keys(resources[code].translation));
      const rules = new Intl.PluralRules(code);
      for (const k of plural) {
        for (let n = 0; n <= 30; n++) {
          const form = `${k}_${rules.select(n)}`;
          expect(have.has(form), `${code}: ${form}`).toBe(true);
        }
      }
    }
  });
  it('no translation is empty', () => {
    for (const { code } of LANGUAGES) {
      const flat = JSON.stringify(resources[code].translation);
      expect(flat.includes('""'), code).toBe(false);
    }
  });
  it('Arabic is right-to-left', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('sw')).toBe(false);
  });
  it('falls back to English for unknown codes', () => {
    expect(normaliseLanguage('de')).toBe('en');
    expect(normaliseLanguage('fr-FR')).toBe('fr');
    expect(normaliseLanguage(null)).toBe('en');
  });
});
