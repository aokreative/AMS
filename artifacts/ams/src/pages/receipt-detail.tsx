import { useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { getCurrency } from '@/lib/money';
import { usePolicies } from '@/hooks/queries';
import {
  useReceipt, useLinkStatementLine, useApplyReceiptAllocations, useInsurerReceivables, useUndoAllocation, useDeleteReceipt, getReceiptPdfUrl,
  type ReceiptLineWithPolicy,
} from '@/hooks/receipts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AllocateOutstanding, allocationCents, type AllocationState } from '@/components/receipts/AllocateOutstanding';
import { formatKes } from '@/lib/receipt-grid';
import { toCents } from '@/lib/reconcile';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ArrowLeft, FileText, Trash2 } from 'lucide-react';

export default function ReceiptDetail() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { isOwnerOrManager } = useAuth();
  const { toast } = useToast();

  const { data: receipt, isLoading } = useReceipt(params.id);
  const linkLine = useLinkStatementLine();
  const undo = useUndoAllocation();
  const deleteReceipt = useDeleteReceipt();
  const applyMoney = useApplyReceiptAllocations();

  const [linkingLine, setLinkingLine] = useState<ReceiptLineWithPolicy | null>(null);
  const [policySearch, setPolicySearch] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [allocState, setAllocState] = useState<AllocationState>({});
  const { data: receivables } = useInsurerReceivables(applyOpen ? receipt?.insurer_id : undefined);
  const { data: insurerPolicies } = usePolicies(receipt ? { insurerId: receipt.insurer_id } : undefined);

  const showError = (err: Error) => toast({ title: t('money.shared.error'), description: err.message, variant: 'destructive' });

  if (!isOwnerOrManager) {
    return <div className="text-muted-foreground">{t('money.receiptDetail.ownersOnly')}</div>;
  }
  if (isLoading) return <div className="py-8 text-center">{t('common.loading')}</div>;
  if (!receipt) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/receipts')}><ArrowLeft className="w-4 h-4 me-2 rtl:rotate-180" /> {t('nav.receipts')}</Button>
        <div className="text-muted-foreground">{t('money.receiptDetail.notFound')}</div>
      </div>
    );
  }

  const openPdf = async () => {
    if (!receipt.file_path) return;
    try {
      const url = await getReceiptPdfUrl(receipt.file_path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      showError(err as Error);
    }
  };

  const appliedByLine = new Map<string, number>();
  for (const a of receipt.allocations) {
    if (a.statement_line_id) appliedByLine.set(a.statement_line_id, (appliedByLine.get(a.statement_line_id) ?? 0) + a.amount);
  }

  const lineStatus = (l: ReceiptLineWithPolicy) => {
    if (!l.policy_id) return { label: t('money.match.unmatched'), variant: 'destructive' as const };
    if ((appliedByLine.get(l.id) ?? 0) > 0) return { label: t('money.shared.applied'), variant: 'success' as const };
    return { label: t('money.match.matched'), variant: 'secondary' as const };
  };

  const term = policySearch.trim().toLowerCase();
  const policyOptions = (insurerPolicies ?? []).filter(p =>
    !term || p.policy_number.toLowerCase().includes(term) || (p.client?.name ?? '').toLowerCase().includes(term));

  const handleLink = (policyId: string) => {
    if (!linkingLine) return;
    linkLine.mutate({ lineId: linkingLine.id, policyId }, {
      onSuccess: (res) => {
        toast({ title: t('money.receiptDetail.toastLinked', { amount: formatCurrency(Number(res.applied)) }) });
        setLinkingLine(null);
        setPolicySearch('');
      },
      onError: showError,
    });
  };

  const handleUndo = (id: string) => {
    undo.mutate(id, {
      onSuccess: () => toast({ title: t('money.receiptDetail.toastUndone') }),
      onError: showError,
    });
  };

  const handleDelete = () => {
    deleteReceipt.mutate({ id: receipt.id, filePath: receipt.file_path }, {
      onSuccess: () => {
        toast({ title: t('money.receiptDetail.toastDeleted') });
        navigate('/receipts');
      },
      onError: (err) => { showError(err); setDeleteOpen(false); },
    });
  };

  const unappliedCents = toCents(receipt.amount)! - receipt.allocations.reduce((s, a) => s + toCents(a.amount)!, 0);
  const applyCommissions = receivables?.commissions ?? [];
  const pickedCents = applyCommissions.reduce((s, c) => s + allocationCents(c, allocState[c.id]), 0);
  const overCents = pickedCents - unappliedCents;

  const handleApply = () => {
    const allocations = applyCommissions
      .map((c) => ({ commissionId: c.id, cents: allocationCents(c, allocState[c.id]) }))
      .filter((a) => a.cents > 0)
      .map((a) => ({ commissionId: a.commissionId, amount: a.cents / 100 }));
    applyMoney.mutate({ receiptId: receipt.id, allocations }, {
      onSuccess: (res) => {
        toast({ title: t('money.receiptDetail.toastApplied', { applied: formatCurrency(Number(res.applied)), unapplied: formatCurrency(Number(res.unapplied)) }) });
        setApplyOpen(false);
        setAllocState({});
      },
      onError: showError,
    });
  };

  const canDelete = !receipt.is_opening_balance && receipt.allocations.length === 0;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/receipts')}><ArrowLeft className="w-4 h-4 me-2 rtl:rotate-180" /> {t('nav.receipts')}</Button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{receipt.insurer?.name ?? t('money.receiptDetail.receiptFallback')}</h1>
          <p className="text-muted-foreground">
            {t('money.receiptDetail.receivedOn', { date: formatDate(receipt.received_on) })}
            {receipt.bank_reference ? t('money.receiptDetail.refSuffix', { ref: receipt.bank_reference }) : ''}
            {receipt.is_opening_balance && <Badge variant="secondary" className="ms-2 text-muted-foreground">{t('money.shared.openingBalance')}</Badge>}
          </p>
        </div>
        <div className="flex gap-2">
          {unappliedCents > 0 && (
            <Button onClick={() => { setAllocState({}); setApplyOpen(true); }}>{t('money.receiptDetail.applyUnapplied')}</Button>
          )}
          {receipt.file_path && (
            <Button variant="outline" onClick={openPdf}><FileText className="w-4 h-4 me-2" /> {t('money.receiptDetail.viewPdf')}</Button>
          )}
          {!receipt.is_opening_balance && (
            <Button variant="destructive" disabled={!canDelete} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="w-4 h-4 me-2" /> {t('money.shared.delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('money.shared.amount')}</div><div className="text-xl font-bold">{formatCurrency(receipt.amount)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('money.shared.applied')}</div><div className="text-xl font-bold">{formatCurrency(receipt.applied)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">{t('money.shared.unapplied')}</div><div className="text-xl font-bold">{formatCurrency(receipt.unapplied)}</div></CardContent></Card>
      </div>

      {receipt.lines.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{t('money.receiptDetail.statementLines')}</h2>
          <div className="border rounded-md bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('money.receiptDetail.lineNo')}</TableHead>
                  <TableHead>{t('money.shared.policyNumber')}</TableHead>
                  <TableHead>{t('money.shared.client')}</TableHead>
                  <TableHead>{t('money.shared.period')}</TableHead>
                  <TableHead className="text-end">{t('money.shared.commission')}</TableHead>
                  <TableHead>{t('money.shared.status')}</TableHead>
                  <TableHead className="text-end">{t('money.shared.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.lines.map(l => {
                  const st = lineStatus(l);
                  return (
                    <TableRow key={l.id}>
                      <TableCell>{l.line_no}</TableCell>
                      <TableCell>{l.policy_number ?? '-'}</TableCell>
                      <TableCell>{l.client_name ?? '-'}</TableCell>
                      <TableCell>{formatDate(l.period)}</TableCell>
                      <TableCell className="text-end">{formatCurrency(l.commission)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      <TableCell className="text-end">
                        {!l.policy_id && (
                          <Button size="sm" variant="outline" onClick={() => { setLinkingLine(l); setPolicySearch(l.policy_number ?? ''); }}>
                            {t('money.receiptDetail.linkToPolicy')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('money.receiptDetail.appliedToCommissions')}</h2>
        <div className="border rounded-md bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('money.shared.policy')}</TableHead>
                <TableHead>{t('money.shared.client')}</TableHead>
                <TableHead>{t('money.shared.expected')}</TableHead>
                <TableHead className="text-end">{t('money.shared.applied')}</TableHead>
                <TableHead className="text-end">{t('money.shared.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipt.allocations.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('money.receiptDetail.nothingApplied')}</TableCell></TableRow>
              ) : receipt.allocations.map(a => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.commission?.policy ? (
                      <Link href="/commissions" className="font-medium text-primary underline">{a.commission.policy.policy_number}</Link>
                    ) : '-'}
                  </TableCell>
                  <TableCell>{a.commission?.policy?.client?.name ?? '-'}</TableCell>
                  <TableCell>{a.commission ? formatCurrency(a.commission.amount) : '-'}</TableCell>
                  <TableCell className="text-end font-medium">{formatCurrency(a.amount)}</TableCell>
                  <TableCell className="text-end">
                    <Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => handleUndo(a.id)}>{t('money.receiptDetail.undo')}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!linkingLine} onOpenChange={(open) => { if (!open) { setLinkingLine(null); setPolicySearch(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('money.receiptDetail.linkToPolicy')}</DialogTitle>
            <DialogDescription>
              {t('money.receiptDetail.linkDescription', { insurer: receipt.insurer?.name ?? t('money.shared.insurerFallback'), policy: linkingLine?.policy_number ?? '-', client: linkingLine?.client_name ?? '-' })}
            </DialogDescription>
          </DialogHeader>
          <Input placeholder={t('money.receiptDetail.searchPolicyPlaceholder')} value={policySearch} onChange={(e) => setPolicySearch(e.target.value)} />
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {policyOptions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">{t('money.receiptDetail.noMatchingPolicies')}</div>
            ) : policyOptions.slice(0, 50).map(p => (
              <button
                key={p.id}
                type="button"
                className="w-full text-start px-3 py-2 hover:bg-muted disabled:opacity-50"
                disabled={linkLine.isPending}
                onClick={() => handleLink(p.id)}
              >
                <div className="font-medium text-sm">{p.policy_number}</div>
                <div className="text-xs text-muted-foreground">{p.client?.name ?? '-'}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={applyOpen} onOpenChange={(open) => { setApplyOpen(open); if (!open) setAllocState({}); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('money.receiptDetail.applyUnapplied')}</DialogTitle>
            <DialogDescription>
              {t('money.receiptDetail.applyDescription', { currency: getCurrency(), amount: formatKes(unappliedCents), insurer: receipt.insurer?.name ?? t('money.shared.insurerFallback') })}
            </DialogDescription>
          </DialogHeader>
          <AllocateOutstanding commissions={applyCommissions} state={allocState} onChange={setAllocState} />
          {overCents > 0 && (
            <div className="text-sm text-destructive">{t('money.receiptDetail.overUnapplied', { currency: getCurrency(), amount: formatKes(overCents) })}</div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApplyOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleApply} disabled={applyMoney.isPending || pickedCents <= 0 || overCents > 0}>{t('money.shared.confirm')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('money.receiptDetail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('money.receiptDetail.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteReceipt.isPending}>{t('money.shared.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
