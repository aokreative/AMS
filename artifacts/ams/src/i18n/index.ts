import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import sw from './locales/sw.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import es from './locales/es.json';
import ar from './locales/ar.json';

export type LanguageCode = 'en' | 'sw' | 'fr' | 'pt' | 'es' | 'ar';

export const LANGUAGES: { code: LanguageCode; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'sw', name: 'Kiswahili', english: 'Swahili' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'ar', name: 'العربية', english: 'Arabic' },
];

// Page-level strings live in locales/<lang>/<section>.json and are merged in as
// translation.<section>, so each part of the app can be translated on its own.
const sectionFiles = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;

function withSections(lang: LanguageCode, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [path, json] of Object.entries(sectionFiles)) {
    const m = path.match(/\.\/locales\/([a-z]{2})\/([\w-]+)\.json$/);
    if (m && m[1] === lang) out[m[2]] = json;
  }
  return out;
}

export const resources = {
  en: { translation: withSections('en', en) },
  sw: { translation: withSections('sw', sw) },
  fr: { translation: withSections('fr', fr) },
  pt: { translation: withSections('pt', pt) },
  es: { translation: withSections('es', es) },
  ar: { translation: withSections('ar', ar) },
} as const;

export function normaliseLanguage(code: string | null | undefined): LanguageCode {
  const base = (code ?? '').toLowerCase().split('-')[0];
  return (LANGUAGES.find((l) => l.code === base)?.code ?? 'en');
}

export function isRtl(code: string): boolean {
  return normaliseLanguage(code) === 'ar';
}

const STORAGE_KEY = 'ams-lang';

function initialLanguage(): LanguageCode {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) return normaliseLanguage(saved);
  } catch {
    // storage blocked: fall through
  }
  return normaliseLanguage(typeof navigator !== 'undefined' ? navigator.language : 'en');
}

function applyDocument(code: LanguageCode) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = isRtl(code) ? 'rtl' : 'ltr';
}

/** Switch the interface language (and remember it on this device). */
export function setLanguage(code: string | null | undefined): LanguageCode {
  const lang = normaliseLanguage(code);
  void i18n.changeLanguage(lang);
  applyDocument(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  return lang;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});
applyDocument(normaliseLanguage(i18n.language));

export default i18n;
