import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useInitializePayment, tierFitError } from '@/hooks/subscription';
import { ALLOWED_MONTHS, formatKes, OWNERS, paymentAmountKes, TIERS, todayNairobi } from '@/lib/subscription';
import { cn } from '@/lib/utils';

/** Plan cards + months + total + "Pay with Paystack". Used by the setup wizard and the Billing tab. */
export function PlanPicker({ active = true, footer }: { active?: boolean; footer?: React.ReactNode }) {
  const { t } = useTranslation();
  const { agency } = useAuth();
  const init = useInitializePayment();
  const today = todayNairobi();
  const current = agency?.subscription_tier ?? 'starter';
  const [tier, setTier] = useState<string>(current);
  const [months, setMonths] = useState<number>(1);
  const [unfit, setUnfit] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!active || !agency?.id) return;
    setTier(current);
    setMonths(1);
    init.reset();
    let cancelled = false;
    void Promise.all(TIERS.map(async (x) => [x.key, await tierFitError(agency.id, x.key)] as const)).then((rows) => {
      if (!cancelled) setUnfit(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, agency?.id]);

  const isUpgrade = useMemo(() => {
    const cur = TIERS.find((x) => x.key === current);
    const next = TIERS.find((x) => x.key === tier);
    return !!cur && !!next && next.price_kes > cur.price_kes && !!agency?.paid_until && agency.paid_until >= today;
  }, [current, tier, agency?.paid_until, today]);

  const monthChoices = isUpgrade ? [0, ...ALLOWED_MONTHS] : [...ALLOWED_MONTHS];
  const effectiveMonths = monthChoices.includes(months) ? months : 1;

  const amount = useMemo(() => {
    try {
      return paymentAmountKes(TIERS, current, tier, effectiveMonths, agency?.paid_until ?? null, today);
    } catch {
      return null;
    }
  }, [current, tier, effectiveMonths, agency?.paid_until, today]);

  const limits = (x: (typeof TIERS)[number]) => {
    const owners = OWNERS[x.key];
    return [
      x.max_members == null ? t('plans.membersUnlimited') : t('plans.members', { count: x.max_members }),
      owners == null ? t('plans.ownersUnlimited') : t('plans.owners', { count: owners }),
      x.max_active_policies == null ? t('plans.policiesUnlimited') : t('plans.policies', { count: x.max_active_policies }),
    ].join(' · ');
  };

  return (
    <div className="space-y-4">
      <RadioGroup value={tier} onValueChange={setTier} className="space-y-2">
        {TIERS.map((x) => (
          <Label
            key={x.key}
            htmlFor={`tier-${x.key}`}
            className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal', tier === x.key && 'border-primary bg-primary/5')}
          >
            <RadioGroupItem id={`tier-${x.key}`} value={x.key} className="mt-1" />
            <span className="flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {x.name}
                  {x.key === current && agency?.paid_until && (
                    <span className="ms-2 text-xs font-normal text-muted-foreground">{t('plans.current')}</span>
                  )}
                </span>
                <span className="text-sm font-medium whitespace-nowrap">
                  {formatKes(x.price_kes)} <span className="text-xs text-muted-foreground">{t('plans.perMonth')}</span>
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">{limits(x)}</span>
              {unfit[x.key] && <span className="block text-xs text-destructive">{unfit[x.key]}</span>}
            </span>
          </Label>
        ))}
      </RadioGroup>

      <div className="space-y-2">
        <Label>{t('plans.months')}</Label>
        <Select value={String(effectiveMonths)} onValueChange={(v) => setMonths(Number(v))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {monthChoices.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m === 0 ? 'Upgrade only (rest of this period)' : t('plans.month', { count: m })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {amount && (
        <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
          {amount.difference > 0 && (
            <div className="flex justify-between"><span>Difference for the rest of this period</span><span>{formatKes(amount.difference)}</span></div>
          )}
          {amount.months > 0 && (
            <div className="flex justify-between">
              <span>{t('plans.month', { count: effectiveMonths })} · {TIERS.find((x) => x.key === tier)?.name}</span>
              <span>{formatKes(amount.months)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('plans.total')}</span><span>{formatKes(amount.total)}</span></div>
        </div>
      )}

      {init.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{(init.error as Error).message}</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {footer}
        <Button
          onClick={() => init.mutate({ tier, months: effectiveMonths })}
          disabled={!amount || !!unfit[tier] || init.isPending || init.isSuccess}
        >
          {(init.isPending || init.isSuccess) && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {amount ? t('plans.pay', { amount: formatKes(amount.total) }) : 'Paystack'}
        </Button>
      </div>
    </div>
  );
}
