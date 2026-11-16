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

export const resources = {
  en: { translation: en },
  sw: { translation: sw },
  fr: { translation: fr },
  pt: { translation: pt },
  es: { translation: es },
  ar: { translation: ar },
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
