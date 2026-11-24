import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, nextTheme, readTheme, resolveTheme, systemPrefersDark, writeTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Current theme, kept in sync across every toggle on the page and with the device setting. */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readTheme(), systemPrefersDark()));

  useEffect(() => {
    const sync = () => setTheme(resolveTheme(readTheme(), systemPrefersDark()));
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', () => {
      if (readTheme() === 'system') {
        applyTheme(resolveTheme('system', mq.matches));
        sync();
      }
    });
    window.addEventListener('ams-theme', sync);
    return () => window.removeEventListener('ams-theme', sync);
  }, []);

  const toggle = () => {
    const next = nextTheme(theme);
    writeTheme(next);
    applyTheme(next);
    setTheme(next);
    window.dispatchEvent(new Event('ams-theme'));
  };
  return [theme, toggle];
}

/** Light/dark switch. Follows the device until the person picks one. */
export function ThemeToggle({ className, showLabel }: { className?: string; showLabel?: boolean }) {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg p-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {showLabel && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
