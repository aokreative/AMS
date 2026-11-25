import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreditCard, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePayments, useSubscriptionUsage } from '@/hooks/subscription';
import { agencyAccess, daysLeft, formatKes, tierName, TIERS, todayNairobi } from '@/lib/subscription';
import { PayDialog } from './PayDialog';
import { usePlanPrice } from '@/hooks/fx';
import { formatDate } from '@/lib/utils';

const fmt = (d: string) => formatDate(d);

function UsageRow({ label, used, max }: { label: string; used: number; max: number | null }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{max == null ? t('billing.usedUnlimited', { used }) : t('billing.usedOf', { used, max })}</span>
      </div>
      {max != null && <Progress value={Math.min(100, (used / max) * 100)} />}
    </div>
  );
}

export function BillingTab({ welcome }: { welcome?: boolean }) {
  const { t } = useTranslation();
  const price = usePlanPrice();
  const { agency } = useAuth();
  const { data: payments } = usePayments();
  const { data: usage } = useSubscriptionUsage();
  const [payOpen, setPayOpen] = useState(false);
  if (!agency) return null;

  const today = todayNairobi();
  const access = agencyAccess(agency, today);
  const left = daysLeft(agency, today);
  const comped = !!agency.complimentary_until && agency.complimentary_until >= today;
  const tier = TIERS.find((x) => x.key === agency.subscription_tier);

  let status: React.ReactNode;
  if (comped) status = t('billing.statusComped', { date: fmt(agency.complimentary_until!) });
  else if (access === 'active') status = t('billing.statusActive', { date: fmt(agency.paid_until!) });
  else if (access === 'grace') status = t('billing.statusGrace', { date: fmt(agency.paid_until!), count: 3 + (left ?? 0) + 1 });
  else status = agency.paid_until ? t('billing.statusStopped', { date: fmt(agency.paid_until) }) : t('billing.statusNone');

  return (
    <div className="space-y-6 max-w-3xl">
      {welcome && !agency.paid_until && !comped && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">{t('billing.welcomeTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('billing.welcomeBody')}</p>
              </div>
            </div>
            <Button onClick={() => setPayOpen(true)}>{t('billing.choosePlan')}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> {t('billing.planName', { plan: tierName(agency.subscription_tier) })}</CardTitle>
            <CardDescription className="mt-1">{status}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={access === 'active' ? 'secondary' : 'destructive'}>
              {comped ? t('billing.badgeComped') : access === 'active' ? t('billing.badgeActive') : access === 'grace' ? t('billing.badgeGrace') : t('billing.badgeUnpaid')}
            </Badge>
            {!comped && <Button size="sm" onClick={() => setPayOpen(true)}>{access === 'active' ? t('billing.renew') : t('billing.payNow')}</Button>}
          </div>
        </CardHeader>
        {usage && tier && (
          <CardContent className="space-y-4">
            <UsageRow label={t('billing.usageMembers')} used={usage.members + usage.pending_invites} max={comped ? null : tier.max_members} />
            <UsageRow label={t('billing.usagePolicies')} used={usage.active_policies} max={comped ? null : tier.max_active_policies} />
            <p className="text-xs text-muted-foreground">{t('billing.perMonthLine', { price: price.main(tier.price_kes) })}
              {price.charged(tier.price_kes) && <> {t('billing.approxNote', { currency: price.currency })}</>}</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('billing.payments')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {payments && payments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('billing.colDate')}</TableHead><TableHead>{t('billing.colPlan')}</TableHead><TableHead>{t('billing.colMonths')}</TableHead>
                  <TableHead className="text-end">{t('billing.colAmount')}</TableHead><TableHead>{t('billing.colMethod')}</TableHead><TableHead>{t('billing.colStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{fmt(p.paid_at ?? p.created_at)}</TableCell>
                    <TableCell>{tierName(p.tier)}</TableCell>
                    <TableCell>{p.months === 0 ? t('billing.upgrade') : p.months}</TableCell>
                    <TableCell className="text-end whitespace-nowrap">{formatKes(p.amount_kes)}</TableCell>
                    <TableCell>{p.channel === 'mobile_money' ? 'M-Pesa' : p.channel === 'card' ? t('billing.card') : p.channel ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'paid' ? 'secondary' : p.status === 'failed' ? 'destructive' : 'outline'} >{p.status === 'needs_review' ? t('billing.heldForReview') : p.status === 'paid' ? t('billing.paid') : p.status === 'failed' ? t('billing.failed') : t('billing.pending')}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t('billing.noPayments')}</p>
          )}
        </CardContent>
      </Card>

      <PayDialog open={payOpen} onOpenChange={setPayOpen} />
    </div>
  );
}
