import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { CURRENCIES, formatMoney, type CurrencyCode } from '@/lib/money';
import { LANGUAGES, setLanguage } from '@/i18n';

interface SettingChange {
  id: string;
  setting: 'currency' | 'language';
  old_value: string;
  new_value: string;
  changed_at: string;
  user: { full_name: string } | null;
}

const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

/**
 * Agency language and currency (Owner only). Changing the currency only
 * relabels amounts; nothing is converted, so switching back shows the
 * figures exactly as before. Every change is listed with "Switch back".
 */
export function LanguageCurrencyCard() {
  const { t } = useTranslation();
  const { agency, isOwner, refreshProfile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pendingCurrency, setPendingCurrency] = useState<CurrencyCode | null>(null);

  const history = useQuery({
    queryKey: ['agency-setting-changes', agency?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agency_setting_changes')
        .select('id, setting, old_value, new_value, changed_at, user:users!agency_setting_changes_changed_by_fkey(full_name)')
        .eq('agency_id', agency!.id)
        .order('changed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as SettingChange[];
    },
    enabled: !!agency?.id && isOwner,
  });

  const save = useMutation({
    mutationFn: async ({ setting, value }: { setting: 'currency' | 'language'; value: string }) => {
      const fn = setting === 'currency' ? 'set_agency_currency' : 'set_agency_language';
      const arg = setting === 'currency' ? { p_currency: value } : { p_language: value };
      const { error } = await supabase.rpc(fn, arg);
      if (error) throw error;
    },
    onSuccess: async (_d, v) => {
      if (v.setting === 'language') setLanguage(v.value);
      await refreshProfile();
      void qc.invalidateQueries({ queryKey: ['agency-setting-changes'] });
      void qc.invalidateQueries();
      toast({ title: v.setting === 'currency' ? t('agency.currencyNow', { value: v.value }) : t('agency.languageNow', { value: languageName(v.value) }) });
    },
    onError: (err: any) => toast({ title: t('agency.couldNotSave'), description: err.message, variant: 'destructive' }),
  });

  if (!agency) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t('agency.languageCurrency')}</CardTitle>
        <CardDescription>
          {t('agency.languageCurrencyDesc')}{' '}
          {isOwner ? t('agency.ownersOnlyChange') : t('agency.ownerOnlyChange')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('agency.languageLabel')}</Label>
            <Select
              value={agency.language}
              disabled={!isOwner || save.isPending}
              onValueChange={(v) => save.mutate({ setting: 'language', value: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('agency.currencyLabel')}</Label>
            <Select
              value={agency.currency}
              disabled={!isOwner || save.isPending}
              onValueChange={(v) => setPendingCurrency(v as CurrencyCode)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isOwner && (history.data?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('agency.recentChanges')}</div>
            <ul className="divide-y rounded-md border text-sm">
              {history.data!.map((h) => {
                const current = h.setting === 'currency' ? agency.currency : agency.language;
                const label = (v: string) => (h.setting === 'currency' ? v : languageName(v));
                return (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="capitalize">{h.setting === 'currency' ? t('agency.currencyLabel') : t('agency.languageLabel')}</span>: {label(h.old_value)} → {label(h.new_value)}
                      <span className="block text-xs text-muted-foreground">
                        {format(new Date(h.changed_at), 'd MMM yyyy, HH:mm')}{h.user ? ` · ${h.user.full_name}` : ''}
                      </span>
                    </span>
                    {current !== h.old_value && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={save.isPending}
                        onClick={() => save.mutate({ setting: h.setting, value: h.old_value })}
                      >
                        {t('agency.switchBack', { value: label(h.old_value) })}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!pendingCurrency} onOpenChange={(o) => { if (!o) setPendingCurrency(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('agency.changeCurrencyTitle', { currency: pendingCurrency })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('agency.changeCurrencyDesc', {
                from: formatMoney(15000, agency.currency),
                to: formatMoney(15000, pendingCurrency ?? agency.currency),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCurrency) save.mutate({ setting: 'currency', value: pendingCurrency });
                setPendingCurrency(null);
              }}
            >
              {t('agency.changeTo', { currency: pendingCurrency })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
