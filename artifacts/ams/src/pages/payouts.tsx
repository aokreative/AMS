import { useTranslation } from 'react-i18next';
import { getCurrency } from '@/lib/money';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useAgencyUsers } from '@/hooks/queries';
import {
  useOwedToAgents, usePayouts, usePreviewPayout, useCreatePayout, useVoidPayout, useAddAdjustment,
} from '@/hooks/payouts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatDay, kes, methodLabel, todayLocal } from '@/lib/payouts';
import { fromCents, toCents } from '@/lib/reconcile';
import type { PayoutMethod, EarningKind } from '@/lib/types';
import { Plus } from 'lucide-react';

const AMOUNT_CHANGED = 'The amount owed changed — review the payout again';

function useLabels() {
  const { t } = useTranslation();
  const method = (m: PayoutMethod) => (m === 'bank' ? t('payouts.bank') : m === 'cash' ? t('payouts.cash') : methodLabel(m));
  const earning = (e: { kind: EarningKind; note?: string | null }) =>
    e.kind === 'commission' ? t('payouts.commission') : e.kind === 'reversal' ? t('payouts.reversal') : e.note?.trim() || t('payouts.adjustment');
  return { method, earning };
}

function useMemberOptions() {
  const { t } = useTranslation();
  const { data: users } = useAgencyUsers();
  return (users ?? []).map((u) => ({
    id: u.id,
    label: u.deactivated_at ? t('payouts.removedSuffix', { name: u.full_name }) : u.full_name,
  }));
}

function NewPayoutDialog({ open, onOpenChange, initialAgentId }: { open: boolean; onOpenChange: (o: boolean) => void; initialAgentId?: string }) {
  const { t } = useTranslation();
  const { method: methodText, earning: earningText } = useLabels();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const members = useMemberOptions();
  const createPayout = useCreatePayout();
  const [agentId, setAgentId] = useState(initialAgentId ?? '');
  const [periodEnd, setPeriodEnd] = useState(todayLocal());
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [method, setMethod] = useState<PayoutMethod | ''>('');
  const [reference, setReference] = useState('');

  const { data: preview, isFetching, error: previewError, refetch: refetchPreview } = usePreviewPayout(agentId || undefined, periodEnd || undefined);
  const total = preview ? Number(preview.total) : 0;
  const nothing = !!preview && total <= 0;

  const reset = (o: boolean) => {
    if (!o) {
      setAgentId(initialAgentId ?? '');
      setPeriodEnd(todayLocal());
      setPaidOn(todayLocal());
      setMethod('');
      setReference('');
    }
    onOpenChange(o);
  };

  const confirm = () => {
    if (!preview) return;
    createPayout.mutate(
      { agentId, periodEnd, paidOn, method, reference, expectedTotal: total },
      {
        onSuccess: (res) => {
          toast({ title: t('payouts.payoutRecorded', { amount: kes(res.amount) }) });
          reset(false);
          navigate(`/payouts/${res.payout_id}`);
        },
        onError: (err: any) => {
          toast({ title: t('payouts.couldNotRecord'), description: err.message, variant: 'destructive' });
          // Stale preview: show the new amount and keep the dialog open for review
          if (err?.message === AMOUNT_CHANGED) refetchPreview();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('payouts.newPayout')}</DialogTitle>
          <DialogDescription>{t('payouts.newPayoutDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('payouts.agent')}</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder={t('payouts.selectAgent')} /></SelectTrigger>
              <SelectContent>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-end">{t('payouts.payUpTo')}</Label>
            <Input id="period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>

        {agentId && periodEnd && (
          <div className="space-y-2">
            {previewError ? (
              <div className="text-sm text-destructive">{(previewError as Error).message}</div>
            ) : isFetching && !preview ? (
              <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
            ) : preview ? (
              <>
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
                      {preview.lines.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">{t('payouts.nothingOwed')}</TableCell></TableRow>
                      ) : preview.lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{formatDay(l.earned_on)}</TableCell>
                          {l.kind === 'adjustment' ? (
                            <TableCell colSpan={4}>{earningText(l)}</TableCell>
                          ) : (
                            <>
                              <TableCell>
                                {l.policy_number ?? '-'}
                                {l.kind === 'reversal' && <Badge variant="secondary" className="ms-2">{t('payouts.reversal')}</Badge>}
                              </TableCell>
                              <TableCell>{l.client_name ?? '-'}</TableCell>
                              <TableCell className="text-end">{kes(l.base_amount)}</TableCell>
                              <TableCell className="text-end">{l.rate != null ? `${Number(l.rate)}%` : '-'}</TableCell>
                            </>
                          )}
                          <TableCell className="text-end font-medium">{kes(l.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-between font-semibold px-1">
                  <span>{t('payouts.total')}</span>
                  <span>{kes(total)}</span>
                </div>
              </>
            ) : null}
          </div>
        )}

        {preview && !nothing && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paid-on">{t('payouts.paidOn')}</Label>
              <Input id="paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('payouts.method')}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PayoutMethod)}>
                <SelectTrigger><SelectValue placeholder={t('payouts.selectMethod')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mpesa">{methodText('mpesa')}</SelectItem>
                  <SelectItem value="bank">{methodText('bank')}</SelectItem>
                  <SelectItem value="cash">{methodText('cash')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">{t('payouts.reference')}</Label>
              <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('payouts.referencePlaceholder')} />
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {nothing && <span className="text-sm text-muted-foreground sm:me-auto">{t('payouts.nothingToPay')}</span>}
          <Button variant="outline" onClick={() => reset(false)}>{t('common.cancel')}</Button>
          <Button onClick={confirm} disabled={!agentId || !preview || nothing || !method || !paidOn || isFetching || createPayout.isPending}>
            {createPayout.isPending ? t('payouts.recording') : t('payouts.confirmPayout')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAdjustmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const members = useMemberOptions();
  const addAdjustment = useAddAdjustment();
  const [agentId, setAgentId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const reset = (o: boolean) => {
    if (!o) { setAgentId(''); setAmount(''); setNote(''); }
    onOpenChange(o);
  };

  const save = () => {
    const cents = toCents(amount);
    addAdjustment.mutate(
      { agentId, amount: cents === null ? null : fromCents(cents), note },
      {
        onSuccess: () => { toast({ title: t('payouts.adjustmentAdded') }); reset(false); },
        onError: (err: any) => toast({ title: t('payouts.couldNotAddAdjustment'), description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payouts.addAdjustment')}</DialogTitle>
          <DialogDescription>{t('payouts.adjustmentDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('payouts.agent')}</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder={t('payouts.selectAgent')} /></SelectTrigger>
              <SelectContent>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj-amount">{t('payouts.adjAmountLabel', { currency: getCurrency() })}</Label>
            <Input id="adj-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('payouts.adjAmountPlaceholder')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj-note">{t('payouts.note')}</Label>
            <Textarea id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('payouts.notePlaceholder')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={!agentId || addAdjustment.isPending}>
            {addAdjustment.isPending ? t('payouts.saving') : t('payouts.addAdjustment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Payouts() {
  const { t } = useTranslation();
  const { method: methodText } = useLabels();
  const { isOwner, isOwnerOrManager } = useAuth();
  const { toast } = useToast();
  const members = useMemberOptions();
  const [agentFilter, setAgentFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [newFor, setNewFor] = useState<string | undefined>();
  const [adjOpen, setAdjOpen] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const voidPayout = useVoidPayout();

  const { data: owed, isLoading: owedLoading } = useOwedToAgents();
  const { data: payouts, isLoading } = usePayouts({ agentId: agentFilter === 'all' ? undefined : agentFilter });

  if (!isOwnerOrManager) {
    return <div className="text-muted-foreground">{t('payouts.onlyOwnersManagers')}</div>;
  }

  const openNew = (agentId?: string) => { setNewFor(agentId); setNewOpen(true); };

  const confirmVoid = () => {
    if (!voiding) return;
    voidPayout.mutate(voiding, {
      onSuccess: () => { toast({ title: t('payouts.payoutVoided') }); setVoiding(null); },
      onError: (err: any) => { toast({ title: t('payouts.couldNotVoid'), description: err.message, variant: 'destructive' }); setVoiding(null); },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="sr-only">{t('payouts.title')}</h1>
          <p className="text-muted-foreground">{t('payouts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {isOwner && <Button variant="outline" onClick={() => setAdjOpen(true)}>{t('payouts.addAdjustment')}</Button>}
          <Button onClick={() => openNew()}><Plus className="w-4 h-4 me-2" /> {t('payouts.newPayout')}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-lg">{t('payouts.owedToAgents')}</CardTitle></CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payouts.agent')}</TableHead>
                  <TableHead className="text-end">{t('payouts.unpaid')}</TableHead>
                  <TableHead>{t('payouts.lastPaid')}</TableHead>
                  <TableHead className="text-end"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {owedLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6">{t('common.loading')}</TableCell></TableRow>
                ) : !owed || owed.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">{t('payouts.noEarnings')}</TableCell></TableRow>
                ) : owed.map((o) => (
                  <TableRow key={o.agentId}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="text-end">{kes(o.unpaid)}</TableCell>
                    <TableCell>{formatDay(o.lastPaidOn)}</TableCell>
                    <TableCell className="text-end">
                      <Button variant="outline" size="sm" onClick={() => openNew(o.agentId)}>{t('payouts.pay')}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <h2 className="text-lg font-semibold tracking-tight">{t('payouts.title')}</h2>
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-full bg-card sm:w-[220px]"><SelectValue placeholder={t('payouts.agent')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('payouts.allAgents')}</SelectItem>
              {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="border rounded-md bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payouts.paidOn')}</TableHead>
                <TableHead>{t('payouts.agent')}</TableHead>
                <TableHead>{t('payouts.method')}</TableHead>
                <TableHead>{t('payouts.reference')}</TableHead>
                <TableHead className="text-end">{t('payouts.amount')}</TableHead>
                <TableHead>{t('payouts.status')}</TableHead>
                {isOwner && <TableHead className="text-end"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={isOwner ? 7 : 6} className="text-center py-8">{t('common.loading')}</TableCell></TableRow>
              ) : !payouts || payouts.length === 0 ? (
                <TableRow><TableCell colSpan={isOwner ? 7 : 6} className="text-center py-8 text-muted-foreground">{t('payouts.noPayouts')}</TableCell></TableRow>
              ) : payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/payouts/${p.id}`} className="font-medium text-primary underline">{formatDay(p.paid_on)}</Link>
                  </TableCell>
                  <TableCell>{p.agent?.full_name ?? '-'}</TableCell>
                  <TableCell>{methodText(p.method)}</TableCell>
                  <TableCell>{p.reference ?? '-'}</TableCell>
                  <TableCell className="text-end font-medium">{kes(p.amount)}</TableCell>
                  <TableCell>{p.voided_at ? <Badge variant="destructive">{t('payouts.voided')}</Badge> : <Badge variant="success">{t('payouts.paid')}</Badge>}</TableCell>
                  {isOwner && (
                    <TableCell className="text-end">
                      {!p.voided_at && <Button variant="outline" size="sm" onClick={() => setVoiding(p.id)}>{t('payouts.void')}</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <NewPayoutDialog key={newFor ?? 'none'} open={newOpen} onOpenChange={setNewOpen} initialAgentId={newFor} />
      {isOwner && <AddAdjustmentDialog open={adjOpen} onOpenChange={setAdjOpen} />}

      <AlertDialog open={!!voiding} onOpenChange={(o) => { if (!o) setVoiding(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('payouts.voidTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('payouts.voidDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmVoid} disabled={voidPayout.isPending}>{t('payouts.voidAction')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
