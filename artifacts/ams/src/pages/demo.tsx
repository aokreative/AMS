import { useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, PartyPopper } from 'lucide-react';
import { BrandMark } from '@/components/BrandLockup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlanPicker } from '@/components/billing/PlanPicker';
import { CURRENCIES, formatMoney, type CurrencyCode } from '@/lib/money';
import { LANGUAGES, normaliseLanguage, setLanguage, type LanguageCode } from '@/i18n';
import { TIERS } from '@/lib/subscription';
import { cn } from '@/lib/utils';
import { Choice } from '@/pages/onboarding';

/** Sample figures shown in the chosen currency on the currency step. */
const SAMPLE = [
  { label: 'Premium', amount: 48500 },
  { label: 'Commission', amount: 4850 },
];

/**
 * Public practice run of the agency setup (language → currency → plan) with sample data.
 * Nothing is saved, no account is created and nothing is charged.
 */
export default function Demo() {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [lang, setLang] = useState<LanguageCode>(normaliseLanguage(i18n.language));
  const [currency, setCur] = useState<CurrencyCode>('KES');
  const [plan, setPlan] = useState<string>('starter');

  const restart = () => {
    setStep(1);
    setCur('KES');
    setPlan('starter');
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/login" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />
          {t('demo.signIn')}
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              {t('demo.title')} <Badge variant="secondary">{t('demo.badge')}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('demo.agency')}
              {step <= 3 && <> · {t('onboarding.step', { n: step })}</>}
            </p>
          </div>
        </div>
        <p className="mb-4 rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">{t('demo.subtitle')}</p>
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
                    onClick={() => {
                      setLang(l.code);
                      setLanguage(l.code);
                    }}
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
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 text-sm">
                  {SAMPLE.map((s) => (
                    <div key={s.label}>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                      <div className="font-semibold">{formatMoney(s.amount, currency)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>{t('common.back')}</Button>
                <Button onClick={() => setStep(3)}>{t('common.continue')}</Button>
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
                <PlanPicker
                  demo
                  onDemoChoose={(tier) => {
                    setPlan(tier);
                    setStep(4);
                    window.scrollTo({ top: 0 });
                  }}
                  footer={
                    <Button variant="ghost" onClick={() => setStep(2)}>{t('common.back')}</Button>
                  }
                />
                <p className="mt-3 text-xs text-muted-foreground">{t('demo.payNote')}</p>
              </CardContent>
            </>
          )}

          {step === 4 && (
            <>
              <CardHeader className="items-center text-center">
                <PartyPopper className="h-10 w-10 text-primary" />
                <CardTitle>{t('demo.doneTitle')}</CardTitle>
                <CardDescription>
                  {t('demo.doneBody', { plan: TIERS.find((x) => x.key === plan)?.name })}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="text-muted-foreground">{t('common.language')}</span>
                  <span className="font-medium">{LANGUAGES.find((l) => l.code === lang)?.name}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="text-muted-foreground">{t('demo.currency')}</span>
                  <span className="font-medium">{currency}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="text-muted-foreground">{t('demo.plan')}</span>
                  <span className="font-medium">{TIERS.find((x) => x.key === plan)?.name}</span>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
                <Button variant="outline" onClick={restart} className="w-full sm:w-auto">{t('demo.restart')}</Button>
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/register">{t('demo.create')}</Link>
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
