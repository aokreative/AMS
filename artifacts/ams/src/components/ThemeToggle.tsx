import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { applyTheme, readTheme, resolveTheme, systemPrefersDark, writeTheme, type ThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePref; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/** The saved choice, kept in sync across the page and with the device when on "System". */
function useThemePref(): [ThemePref, (p: ThemePref) => void, boolean] {
  const [pref, setPref] = useState<ThemePref>(() => readTheme());
  const [dark, setDark] = useState(() => resolveTheme(readTheme(), systemPrefersDark()) === 'dark');

  useEffect(() => {
    const sync = () => {
      const p = readTheme();
      setPref(p);
      setDark(resolveTheme(p, systemPrefersDark()) === 'dark');
    };
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (readTheme() === 'system') {
        applyTheme(resolveTheme('system', !!mq?.matches));
        sync();
      }
    };
    mq?.addEventListener('change', onSystemChange);
    window.addEventListener('ams-theme', sync);
    return () => {
      mq?.removeEventListener('change', onSystemChange);
      window.removeEventListener('ams-theme', sync);
    };
  }, []);

  const choose = (p: ThemePref) => {
    writeTheme(p);
    applyTheme(resolveTheme(p, systemPrefersDark()));
    window.dispatchEvent(new Event('ams-theme'));
  };
  return [pref, choose, dark];
}

/** Light / Dark / System menu. Light by default; the choice is remembered on this device. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [pref, choose, dark] = useThemePref();
  const Icon = pref === 'system' ? Monitor : dark ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('workspace.theme.appearance')}
          title={t('workspace.theme.appearance')}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => choose(o.value)} className="gap-2">
            <o.icon className="h-4 w-4" />
            <span className="flex-1">{t(`workspace.theme.${o.value}`)}</span>
            {pref === o.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
