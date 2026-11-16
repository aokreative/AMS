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
  it('every language has exactly the English keys', () => {
    const en = keys(resources.en.translation);
    for (const { code } of LANGUAGES) {
      expect(keys(resources[code].translation), code).toEqual(en);
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
