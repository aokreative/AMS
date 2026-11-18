import { useTranslation } from 'react-i18next';
import { Check, Sparkles } from 'lucide-react';
import { OWNERS, planGains, TIERS, type PlanGain } from '@/lib/subscription';

export const PLAN_FEATURES = ['clients', 'commissions', 'receipts', 'payouts', 'renewals', 'reports', 'team', 'languages'] as const;

/** Who a plan suits, its limits, what it adds over the plan below, and what every plan includes. */
export function PlanDetails({ tier }: { tier: string }) {
  const { t } = useTranslation();
  const x = TIERS.find((p) => p.key === tier);
  if (!x) return null;
  const i = TIERS.indexOf(x);
  const prev = i > 0 ? TIERS[i - 1] : null;
  const owners = OWNERS[x.key];

  const gainText = (g: PlanGain) => {
    if (g.kind === 'members') return g.value == null ? t('plans.membersUnlimited') : t('plans.members', { count: g.value });
    if (g.kind === 'owners') return g.value == null ? t('plans.ownersUnlimited') : t('plans.owners', { count: g.value });
    return g.value == null ? t('plans.policiesUnlimited') : t('plans.policies', { count: g.value });
  };

  const limits = [
    x.max_members == null ? t('plans.membersUnlimited') : t('plans.members', { count: x.max_members }),
    owners == null ? t('plans.ownersUnlimited') : t('plans.owners', { count: owners }),
    x.max_active_policies == null ? t('plans.policiesUnlimited') : t('plans.policies', { count: x.max_active_policies }),
  ];
  const gains = planGains(x.key);
  const prevValue = (kind: PlanGain['kind']) => {
    if (!prev) return '';
    const v = kind === 'members' ? prev.max_members : kind === 'owners' ? OWNERS[prev.key] : prev.max_active_policies;
    return v == null ? '∞' : v.toLocaleString();
  };

  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" data-testid="plan-details">
      <p>
        <span className="font-medium">{t('plans.bestFor')}: </span>
        <span className="text-muted-foreground">{t(`plans.for_${x.key}`)}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('plans.limits')}</p>
          <ul className="mt-1 space-y-0.5">
            {limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        {prev && gains.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('plans.gains', { plan: prev.name })}</p>
            <ul className="mt-1 space-y-0.5">
              {gains.map((g) => (
                <li key={g.kind} className="flex items-center gap-1.5 text-primary">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {gainText(g)}{' '}
                    <span className="text-xs text-muted-foreground">({prev.name}: {prevValue(g.kind)})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('plans.included')}</p>
        <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
          {PLAN_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-1.5">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
              <span>{t(`plans.f_${f}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
