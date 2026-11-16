import { useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { CURRENCIES, setCurrency, type CurrencyCode } from '@/lib/money';
import { LANGUAGES, normaliseLanguage, setLanguage, type LanguageCode } from '@/i18n';
import { BrandMark } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlanPicker } from '@/components/billing/PlanPicker';
import { cn } from '@/lib/utils';

function Choice({ selected, onClick, title, hint }: { selected: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-start transition-colors',
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
      aria-pressed={selected}
    >
      <span>
        <span className="block font-medium">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {selected && <Check className="h-4 w-4 text-primary" />}
    </button>
  );
}

/** Owner setup after sign-up: language → currency → plan. */
export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const { session, profile, agency, isLoading, refreshProfile } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [lang, setLang] = useState<LanguageCode>(normaliseLanguage(i18n.language));
  const [currency, setCur] = useState<CurrencyCode>('KES');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setup already saved (e.g. came back to pay): go straight to the plan.
  useEffect(() => {
    if (agency?.setup_completed_at) setStep(3);
    if (agency?.currency) setCur(agency.currency);
  }, [agency?.setup_completed_at, agency?.currency]);

  if (isLoading) return null;
  if (!session) return <Redirect to="/login" />;
  if (!profile) return <Redirect to="/register" />;
  if (profile.role !== 'owner') return <Redirect to="/dashboard" />;

  const comped = !!agency?.complimentary_until && agency.complimentary_until >= new Date().toISOString().slice(0, 10);

  const saveSetup = async () => {
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.rpc('complete_agency_setup', { p_language: lang, p_currency: currency });
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    setCurrency(currency);
    await refreshProfile();
    setStep(3);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-bold">{t('onboarding.title')}</h1>
            <p className="text-sm text-muted-foreground">{agency?.name} · {t('onboarding.step', { n: step })}</p>
          </div>
        </div>
        <div className="mb-6 flex gap-2" aria-hidden>
          {[1, 2, 3].map((n) => (
            <div key={n} className={cn('h-1.5 flex-1 rounded-full', n <= step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>

        <Card>
          {step === 1 && (
            <>
              <CardHeader>
                <CardTitle>{t('onboarding.languageTitle')}</CardTitle>
                <CardDescription>{t('onboarding.languageHint')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {LANGUAGES.map((l) => (
                  <Choice
                    key={l.code}
                    selected={lang === l.code}
                    onClick={() => { setLang(l.code); setLanguage(l.code); }}
                    title={l.name}
                    hint={l.name === l.english ? undefined : l.english}
                  />
                ))}
              </CardContent>
              <CardFooter className="justify-end">
                <Button onClick={() => setStep(2)}>{t('common.continue')}</Button>
              </CardFooter>
            </>
          )}

          {step === 2 && (
            <>
              <CardHeader>
                <CardTitle>{t('onboarding.currencyTitle')}</CardTitle>
                <CardDescription>{t('onboarding.currencyHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {CURRENCIES.map((c) => (
                  <Choice key={c.code} selected={currency === c.code} onClick={() => setCur(c.code)} title={`${c.code} · ${c.name}`} hint={c.country} />
                ))}
                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </CardContent>
              <CardFooter className="justify-between">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>{t('common.back')}</Button>
                <Button onClick={() => void saveSetup()} disabled={saving}>
                  {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                  {saving ? t('onboarding.saving') : t('common.continue')}
                </Button>
              </CardFooter>
            </>
          )}

          {step === 3 && (
            <>
              <CardHeader>
                <CardTitle>{t('onboarding.planTitle')}</CardTitle>
                <CardDescription>{t('onboarding.planHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                {comped ? (
                  <Button className="w-full" onClick={() => setLocation('/dashboard')}>{t('onboarding.finish')}</Button>
                ) : (
                  <PlanPicker
                    footer={
                      <Button variant="outline" onClick={() => setLocation('/dashboard')} title={t('onboarding.payLaterHint')}>
                        {t('onboarding.payLater')}
                      </Button>
                    }
                  />
                )}
                {!comped && <p className="mt-3 text-xs text-muted-foreground">{t('onboarding.payLaterHint')}</p>}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
