import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useInitializePayment, tierFitError } from '@/hooks/subscription';
import { ALLOWED_MONTHS, formatKes, paymentAmountKes, TIERS, todayNairobi } from '@/lib/subscription';
import { cn } from '@/lib/utils';

function limitsLine(maxMembers: number | null, maxPolicies: number | null) {
  const m = maxMembers == null ? 'Unlimited team members' : `Up to ${maxMembers} team members`;
  const p = maxPolicies == null ? 'unlimited policies' : `${maxPolicies} active policies`;
  return `${m} · ${p}`;
}

export function PayDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { agency } = useAuth();
  const init = useInitializePayment();
  const today = todayNairobi();
  const current = agency?.subscription_tier ?? 'starter';
  const [tier, setTier] = useState<string>(current);
  const [months, setMonths] = useState<number>(1);
  const [unfit, setUnfit] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!open || !agency?.id) return;
    setTier(current);
    setMonths(1);
    init.reset();
    let cancelled = false;
    void Promise.all(TIERS.map(async (t) => [t.key, await tierFitError(agency.id, t.key)] as const)).then((rows) => {
      if (!cancelled) setUnfit(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agency?.id]);

  const isUpgrade = useMemo(() => {
    const cur = TIERS.find((t) => t.key === current);
    const next = TIERS.find((t) => t.key === tier);
    return !!cur && !!next && next.price_kes > cur.price_kes && !!agency?.paid_until && agency.paid_until >= today;
  }, [current, tier, agency?.paid_until, today]);

  // An upgrade on a paid-up plan may pay just the difference ("0 more months").
  const monthChoices = isUpgrade ? [0, ...ALLOWED_MONTHS] : [...ALLOWED_MONTHS];
  const effectiveMonths = monthChoices.includes(months) ? months : 1;

  const amount = useMemo(() => {
    try {
      return paymentAmountKes(TIERS, current, tier, effectiveMonths, agency?.paid_until ?? null, today);
    } catch {
      return null;
    }
  }, [current, tier, effectiveMonths, agency?.paid_until, today]);

  const blocked = unfit[tier];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay for your plan</DialogTitle>
          <DialogDescription>Pay with M-Pesa or card through Paystack. Prices are per month.</DialogDescription>
        </DialogHeader>

        <RadioGroup value={tier} onValueChange={setTier} className="space-y-2">
          {TIERS.map((t) => (
            <Label
              key={t.key}
              htmlFor={`tier-${t.key}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal',
                tier === t.key && 'border-primary bg-primary/5',
              )}
            >
              <RadioGroupItem id={`tier-${t.key}`} value={t.key} className="mt-1" />
              <span className="flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {t.name}
                    {t.key === current && <span className="ml-2 text-xs font-normal text-muted-foreground">current</span>}
                  </span>
                  <span className="text-sm font-medium">{formatKes(t.price_kes)}</span>
                </span>
                <span className="block text-xs text-muted-foreground">{limitsLine(t.max_members, t.max_active_policies)}</span>
                {unfit[t.key] && <span className="block text-xs text-destructive">{unfit[t.key]}</span>}
              </span>
            </Label>
          ))}
        </RadioGroup>

        <div className="space-y-2">
          <Label>How many months</Label>
          <Select value={String(effectiveMonths)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthChoices.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m === 0 ? 'Upgrade only (rest of this period)' : `${m} month${m > 1 ? 's' : ''}`}
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
              <div className="flex justify-between"><span>{effectiveMonths} month{effectiveMonths > 1 ? 's' : ''} of {TIERS.find((t) => t.key === tier)?.name}</span><span>{formatKes(amount.months)}</span></div>
            )}
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{formatKes(amount.total)}</span></div>
          </div>
        )}

        {init.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{(init.error as Error).message}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={init.isPending}>Cancel</Button>
          <Button
            onClick={() => init.mutate({ tier, months: effectiveMonths })}
            disabled={!amount || !!blocked || init.isPending || init.isSuccess}
          >
            {(init.isPending || init.isSuccess) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {amount ? `Pay ${formatKes(amount.total)} with Paystack` : 'Pay with Paystack'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
