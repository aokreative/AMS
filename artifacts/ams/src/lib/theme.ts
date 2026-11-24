export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';
export type SidebarMode = 'expanded' | 'collapsed';

const THEME_KEY = 'ams.theme';
const SIDEBAR_KEY = 'ams.sidebar';

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** What the toggle switches to from what is showing now. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // private mode etc.
  }
}

export function readSidebar(): SidebarMode {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {
    return 'expanded';
  }
}

export function writeSidebar(mode: SidebarMode): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, mode);
  } catch {
    // ignore
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
