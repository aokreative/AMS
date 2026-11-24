import { beforeEach, describe, expect, it } from 'vitest';
import { nextTheme, readSidebar, readTheme, resolveTheme, writeSidebar, writeTheme } from './theme';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

describe('theme', () => {
  it('system follows the device; light and dark are fixed', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('defaults to light and remembers any choice, including system', () => {
    expect(readTheme()).toBe('light');
    writeTheme('dark');
    expect(readTheme()).toBe('dark');
    writeTheme('system');
    expect(readTheme()).toBe('system');
    store.set('ams.theme', 'purple');
    expect(readTheme()).toBe('light');
  });
  it('the toggle flips what is showing', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});

describe('sidebar', () => {
  it('expanded by default, remembers collapsed', () => {
    expect(readSidebar()).toBe('expanded');
    writeSidebar('collapsed');
    expect(readSidebar()).toBe('collapsed');
  });
});
