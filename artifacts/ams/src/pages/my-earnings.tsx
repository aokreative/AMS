import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useAgentEarnings, usePayouts } from '@/hooks/payouts';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDay, kes, methodLabel, monthStartLocal, sumCents, yearStartLocal } from '@/lib/payouts';
import { fromCents } from '@/lib/reconcile';
import type { PayoutMethod } from '@/lib/types';

export default function MyEarnings() {
  const { t } = useTranslation();
  const methodText = (m: PayoutMethod) => (m === 'bank' ? t('payouts.bank') : m === 'cash' ? t('payouts.cash') : methodLabel(m));
  const { session } = useAuth();
  const me = session?.id;
  const { data: earnings, isLoading } = useAgentEarnings({ agentId: me });
  const { data: payouts, isLoading: payoutsLoading } = usePayouts({ agentId: me });

  if (!me) return null;

  const all = earnings ?? [];
  const monthStart = monthStartLocal();
  const yearStart = yearStartLocal();
  // ISO date strings compare correctly as text
  const total = (rows: typeof all) => fromCents(sumCents(rows));
  const unpaid = total(all.filter((e) => e.payout_id === null));
  const thisMonth = total(all.filter((e) => e.earned_on >= monthStart));
  const thisYear = total(all.filter((e) => e.earned_on >= yearStart));

  const cards = [
    { label: t('payouts.unpaidNow'), value: unpaid },
    { label: t('payouts.earnedMonth'), value: thisMonth },
    { label: t('payouts.earnedYear'), value: thisYear },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="sr-only">{t('payouts.myTitle')}</h1>
        <p className="text-muted-foreground">{t('payouts.mySubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="bg-card">
            <CardContent className="p-4">
              <div className="text-sm font-medium text-muted-foreground">{c.label}</div>
              <div className="text-2xl font-bold">{isLoading ? '...' : kes(c.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('payouts.myPayouts')}</h2>
        <div className="border rounded-md bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payouts.paidOn')}</TableHead>
                <TableHead>{t('payouts.method')}</TableHead>
                <TableHead>{t('payouts.reference')}</TableHead>
                <TableHead className="text-end">{t('payouts.amount')}</TableHead>
                <TableHead>{t('payouts.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payoutsLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">{t('common.loading')}</TableCell></TableRow>
              ) : !payouts || payouts.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('payouts.noPayouts')}</TableCell></TableRow>
              ) : payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/payouts/${p.id}`} className="font-medium text-primary underline">{formatDay(p.paid_on)}</Link>
                  </TableCell>
                  <TableCell>{methodText(p.method)}</TableCell>
                  <TableCell>{p.reference ?? '-'}</TableCell>
                  <TableCell className="text-end font-medium">{kes(p.amount)}</TableCell>
                  <TableCell>{p.voided_at ? <Badge variant="destructive">{t('payouts.voided')}</Badge> : <Badge variant="success">{t('payouts.paid')}</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
