import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES, normaliseLanguage, setLanguage } from '@/i18n';
import { supabase } from '@/lib/supabase';

/** Switches the interface language; saves it to the profile when signed in. */
export function LanguageSwitcher({ signedIn = false, className }: { signedIn?: boolean; className?: string }) {
  const { i18n, t } = useTranslation();
  const current = normaliseLanguage(i18n.language);
  return (
    <Select
      value={current}
      onValueChange={(code) => {
        setLanguage(code);
        if (signedIn) void supabase.rpc('set_my_language', { p_language: code });
      }}
    >
      <SelectTrigger className={className ?? 'h-8 w-full'} aria-label={t('common.language')}>
        <Languages className="mr-2 h-4 w-4 shrink-0 opacity-70" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((l) => (
          <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
