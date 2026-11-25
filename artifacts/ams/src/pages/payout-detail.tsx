import { useTranslation } from 'react-i18next';
import { Link, useRoute } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { usePayout } from '@/hooks/payouts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDay, kes, methodLabel } from '@/lib/payouts';
import type { PayoutMethod, EarningKind } from '@/lib/types';
import { ArrowLeft, Printer } from 'lucide-react';

export default function PayoutDetail() {
  const { t } = useTranslation();
  const methodText = (m: PayoutMethod) => (m === 'bank' ? t('payouts.bank') : m === 'cash' ? t('payouts.cash') : methodLabel(m));
  const earningText = (e: { kind: EarningKind; note?: string | null }) =>
    e.kind === 'commission' ? t('payouts.commission') : e.kind === 'reversal' ? t('payouts.reversal') : e.note?.trim() || t('payouts.adjustment');
  const [, params] = useRoute('/payouts/:id');
  const { data, isLoading, error } = usePayout(params?.id);
  const { isOwnerOrManager } = useAuth();
  const backHref = isOwnerOrManager ? '/payouts' : '/my-earnings';

  if (isLoading) return <div className="text-muted-foreground">{t('common.loading')}</div>;
  if (error) return <div className="text-destructive">{(error as Error).message}</div>;
  if (!data) return <div className="text-muted-foreground">{t('payouts.notFound')}</div>;

  const { payout: p, earnings } = data;
  const voided = !!p.voided_at;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 print:hidden">
        <Button variant="ghost" asChild>
          <Link href={backHref}><ArrowLeft className="w-4 h-4 me-2 rtl:rotate-180" /> {t('common.back')}</Link>
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="w-4 h-4 me-2" /> {t('payouts.print')}
        </Button>
      </div>

      {voided && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-4 py-3 font-semibold">
          {t('payouts.voidedBanner', { date: formatDay(p.voided_at) })}
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('payouts.statementTitle')}</h1>
        <p className="text-muted-foreground">{p.agent?.full_name ?? t('payouts.agentFallback')}</p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div><dt className="text-muted-foreground">{t('payouts.paidOn')}</dt><dd className="font-medium">{formatDay(p.paid_on)}</dd></div>
        <div><dt className="text-muted-foreground">{t('payouts.earningsUpTo')}</dt><dd className="font-medium">{formatDay(p.period_end)}</dd></div>
        <div><dt className="text-muted-foreground">{t('payouts.method')}</dt><dd className="font-medium">{methodText(p.method)}</dd></div>
        <div><dt className="text-muted-foreground">{t('payouts.reference')}</dt><dd className="font-medium">{p.reference ?? '-'}</dd></div>
      </dl>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payouts.earnedOn')}</TableHead>
              <TableHead>{t('payouts.policy')}</TableHead>
              <TableHead>{t('payouts.client')}</TableHead>
              <TableHead className="text-end">{t('payouts.base')}</TableHead>
              <TableHead className="text-end">{t('payouts.rate')}</TableHead>
              <TableHead className="text-end">{t('payouts.earned')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {earnings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                  {voided ? t('payouts.noLinesVoided') : t('payouts.noLines')}
                </TableCell>
              </TableRow>
            ) : earnings.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{formatDay(e.earned_on)}</TableCell>
                {e.kind === 'adjustment' ? (
                  <TableCell colSpan={4}>{earningText(e)}</TableCell>
                ) : (
                  <>
                    <TableCell>
                      {e.policy_number ?? '-'}
                      {e.kind === 'reversal' && <Badge variant="secondary" className="ms-2">{t('payouts.reversal')}</Badge>}
                    </TableCell>
                    <TableCell>{e.client_name ?? '-'}</TableCell>
                    <TableCell className="text-end">{kes(e.base_amount)}</TableCell>
                    <TableCell className="text-end">{e.rate != null ? `${Number(e.rate)}%` : '-'}</TableCell>
                  </>
                )}
                <TableCell className="text-end font-medium">{kes(e.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end text-xl font-bold">{t('payouts.totalPaid', { amount: kes(p.amount) })}</div>
    </div>
  );
}
