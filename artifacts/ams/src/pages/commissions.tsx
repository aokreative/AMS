import { getCurrency } from '@/lib/money';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useCommissions, useCreateCommission, usePolicies } from '@/hooks/queries';
import { useCreateReceipt } from '@/hooks/receipts';
import { toCents, fromCents } from '@/lib/reconcile';
import { Link } from 'wouter';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils';
import { Search, Filter, CheckCircle2, Plus, Download } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Textarea } from '@/components/ui/textarea';
import { exportToCsv } from '@/lib/csv-export';

const makeCommissionSchema = (t: TFunction) => z.object({
  policy_id: z.string().min(1, t('money.commissions.required')),
  amount: z.coerce.number().min(1, t('money.commissions.mustBePositive')),
  expected_date: z.string().min(1, t('money.commissions.required')),
  notes: z.string().optional()
});

type CommissionFormValues = z.infer<ReturnType<typeof makeCommissionSchema>>;

export default function Commissions() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [payingComm, setPayingComm] = useState<any | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const { profile, isOwnerOrManager } = useAuth();
  const isAgent = !!profile && !isOwnerOrManager;

  const { data: commissions, isLoading } = useCommissions({ status: statusFilter });
  const { data: policies } = usePolicies();
  const createCommission = useCreateCommission();
  const createReceipt = useCreateReceipt();
  const { toast } = useToast();

  const form = useForm<CommissionFormValues>({
    resolver: zodResolver(makeCommissionSchema(t)),
    defaultValues: {
      policy_id: '',
      amount: 0,
      expected_date: new Date().toISOString().split('T')[0],
      notes: ''
    }
  });

  const filteredCommissions = commissions?.filter(c => 
    c.policy?.policy_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.policy?.client?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.policy?.insurer?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const remainingCentsOf = (c: any) => Math.max((toCents(Number(c.amount) || 0) ?? 0) - (toCents(Number(c.amount_received) || 0) ?? 0), 0);
  const remainingOf = (c: any) => fromCents(remainingCentsOf(c));
  const today = new Date().toISOString().split('T')[0];
  const isUnpaid = (c: any) => c.status === 'pending' || c.status === 'part_paid';
  const isOverdueRow = (c: any) => isUnpaid(c) && !!c.expected_date && c.expected_date < today;
  const lastReceivedOn = (c: any): string | null => {
    const dates = ((c.allocations ?? []) as any[]).map(a => a.receipt?.received_on).filter(Boolean) as string[];
    return dates.length ? dates.reduce((m, d) => (d > m ? d : m)) : null;
  };

  const totalExpected = commissions?.reduce((sum, c) => sum + (c.amount || 0), 0) || 0;
  const totalReceived = commissions?.reduce((sum, c) => sum + (Number(c.amount_received) || 0), 0) || 0;
  const totalOverdue = commissions?.filter(isOverdueRow).reduce((sum, c) => sum + remainingOf(c), 0) || 0;

  const collectionRate = totalExpected > 0 ? (totalReceived / totalExpected) * 100 : 0;
  let rateColor = 'text-muted-foreground';
  let rateBg = 'bg-card';
  let rateBorder = 'border-border';
  if (totalExpected > 0) {
    if (collectionRate >= 80) {
      rateColor = 'text-emerald-700 dark:text-emerald-500';
      rateBg = 'bg-emerald-50 dark:bg-emerald-950/20';
      rateBorder = 'border-emerald-200 dark:border-emerald-900';
    } else if (collectionRate >= 50) {
      rateColor = 'text-amber-700 dark:text-amber-500';
      rateBg = 'bg-amber-50 dark:bg-amber-950/20';
      rateBorder = 'border-amber-200 dark:border-amber-900';
    } else {
      rateColor = 'text-red-700 dark:text-red-500';
      rateBg = 'bg-red-50 dark:bg-red-950/20';
      rateBorder = 'border-red-200 dark:border-red-900';
    }
  }

  const nowMs = new Date().getTime();
  const overdueItems = commissions?.filter(isOverdueRow) || [];
  
  const aging = {
    '0-30': { label: t('money.commissions.age0_30'), count: 0, amount: 0 },
    '31-60': { label: t('money.commissions.age31_60'), count: 0, amount: 0 },
    '61-90': { label: t('money.commissions.age61_90'), count: 0, amount: 0 },
    '90+': { label: t('money.commissions.age90plus'), count: 0, amount: 0 }
  };

  overdueItems.forEach(c => {
    const days = Math.floor((nowMs - new Date(c.expected_date).getTime()) / (1000 * 3600 * 24));
    if (days <= 30) { aging['0-30'].count++; aging['0-30'].amount += remainingOf(c); }
    else if (days <= 60) { aging['31-60'].count++; aging['31-60'].amount += remainingOf(c); }
    else if (days <= 90) { aging['61-90'].count++; aging['61-90'].amount += remainingOf(c); }
    else { aging['90+'].count++; aging['90+'].amount += remainingOf(c); }
  });

  const selectedComms = (commissions ?? []).filter(c => selectedIds.has(c.id) && remainingOf(c) > 0);
  const selectedInsurerIds = new Set(selectedComms.map(c => c.policy?.insurer?.id));
  const sameInsurer = selectedComms.length > 0 && selectedInsurerIds.size === 1;
  const selectedTotal = fromCents(selectedComms.reduce((sum, c) => sum + remainingCentsOf(c), 0));

  const showError = (err: Error) => toast({ title: t('money.shared.error'), description: err.message, variant: 'destructive' });

  const openBulkDialog = () => {
    setPayDate(today);
    setPayRef('');
    setBulkOpen(true);
  };

  const handleBulkRecord = () => {
    const insurerId = selectedComms[0]?.policy?.insurer?.id;
    if (!insurerId || !sameInsurer) return;
    createReceipt.mutate({
      insurerId,
      receivedOn: payDate,
      amount: selectedTotal,
      bankReference: payRef.trim() || null,
      allocations: selectedComms.map(c => ({ commission_id: c.id, amount: remainingOf(c) })),
    }, {
      onSuccess: () => {
        toast({ title: t('money.commissions.toastPaymentRecorded') });
        setBulkOpen(false);
        setSelectedIds(new Set());
      },
      onError: showError,
    });
  };

  const toggleSelectAll = () => {
    if (!filteredCommissions) return;
    const selectable = filteredCommissions.filter(c => remainingOf(c) > 0);
    if (selectedIds.size === selectable.length && selectable.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map(c => c.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleReceive = () => {
    const cents = toCents(payAmount);
    const insurerId = payingComm?.policy?.insurer?.id;
    if (!payingComm || !insurerId || cents === null || cents <= 0) return;
    if (cents > remainingCentsOf(payingComm)) {
      toast({ title: t('money.shared.error'), description: t('money.commissions.errExceeds', { amount: formatCurrency(remainingOf(payingComm)) }), variant: 'destructive' });
      return;
    }
    const amount = fromCents(cents);
    createReceipt.mutate({
      insurerId,
      receivedOn: payDate,
      amount,
      bankReference: payRef.trim() || null,
      allocations: [{ commission_id: payingComm.id, amount }],
    }, {
      onSuccess: () => {
        toast({ title: t('money.commissions.toastPaymentRecorded') });
        setPayingComm(null);
      },
      onError: showError,
    });
  };

  const openReceiveDialog = (comm: any) => {
    setPayingComm(comm);
    setPayDate(today);
    setPayAmount(remainingOf(comm).toString());
    setPayRef('');
  };

  const onSubmitAdd = (values: CommissionFormValues) => {
    createCommission.mutate({
      ...values
    }, {
      onSuccess: () => {
        toast({ title: t('money.commissions.toastTransactionAdded') });
        setIsAddOpen(false);
        form.reset();
      },
      onError: (err) => {
        toast({ title: t('money.shared.error'), description: err.message, variant: 'destructive' });
      }
    });
  };

  const handleExportCsv = () => {
    if (!commissions) return;
    const exportData = commissions.map(c => ({
      policy_number: c.policy?.policy_number || '',
      client_name: c.policy?.client?.name || '',
      insurer_name: c.policy?.insurer?.name || '',
      amount: c.amount,
      status: c.status,
      expected_date: c.expected_date,
      received_amount: c.amount_received,
      received_date: lastReceivedOn(c) || ''
    }));
    exportToCsv('commissions', exportData);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="sr-only">{t('nav.commissions')}</h1>
          <p className="text-muted-foreground">{isAgent ? t('money.commissions.agentSubtitle') : t('money.commissions.managerSubtitle')}</p>
        </div>

        {!isAgent && (
        <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) form.reset();
        }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 me-2" /> {t('money.commissions.addTransaction')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('money.commissions.addTitle')}</DialogTitle>
              <DialogDescription>{t('money.commissions.addDescription')}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmitAdd)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="policy_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('money.shared.policy')}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t('money.commissions.selectPolicy')} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {policies?.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.policy_number} - {p.client?.name ?? '—'}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('money.commissions.amountCur', { currency: getCurrency() })}</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="expected_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('money.commissions.expectedDate')}</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('money.commissions.notesOptional')}</FormLabel>
                      <FormControl><Textarea {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createCommission.isPending}>
                  {createCommission.isPending ? t('money.shared.saving') : t('money.commissions.saveTransaction')}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-muted-foreground mb-1">{t('money.commissions.totalExpected')}</div>
            <div className="text-2xl font-bold">{formatCurrency(totalExpected)}</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-emerald-800 dark:text-emerald-400 mb-1">{t('money.commissions.totalReceived')}</div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">{formatCurrency(totalReceived)}</div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-red-800 dark:text-red-400 mb-1">{t('money.commissions.overdueUnpaid')}</div>
            <div className="text-2xl font-bold text-red-700 dark:text-red-500">{formatCurrency(totalOverdue)}</div>
          </CardContent>
        </Card>
        <Card className={`${rateBg} ${rateBorder}`}>
          <CardContent className="p-6">
            <div className={`text-sm font-medium mb-1 ${totalExpected > 0 ? rateColor.replace('700', '800').replace('500', '400') : 'text-muted-foreground'}`}>{t('money.commissions.collectionRate')}</div>
            <div className={`text-2xl font-bold ${rateColor}`}>{totalExpected > 0 ? `${collectionRate.toFixed(1)}%` : '0%'}</div>
          </CardContent>
        </Card>
      </div>

      {overdueItems.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{t('money.commissions.overdueByAge')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {Object.values(aging).map((b, i) => (
              <Card key={i} className={`bg-card ${b.count === 0 ? 'opacity-40' : ''}`}>
                <CardContent className="p-4 flex justify-between items-center">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">{b.label}</div>
                    <div className="text-lg font-bold">{formatCurrency(b.amount)}</div>
                  </div>
                  <Badge variant="secondary">{b.count}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {selectedIds.size > 0 && !isAgent && (
        <div className="sticky top-20 z-10 flex flex-wrap items-center justify-between gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-md shadow-md">
          <div className="text-sm font-medium">{t('money.commissions.selectedCount', { n: selectedIds.size })}</div>
          <div className="flex flex-wrap gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="secondary" onClick={openBulkDialog} disabled={!sameInsurer}>
                    {t('money.commissions.recordPaymentSelected')}
                  </Button>
                </span>
              </TooltipTrigger>
              {!sameInsurer && <TooltipContent>{t('money.commissions.selectOneInsurer')}</TooltipContent>}
            </Tooltip>
            <Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground" onClick={() => setSelectedIds(new Set())}>
              {t('money.commissions.clear')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('money.commissions.searchPlaceholder')}
            className="ps-9 bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExportCsv}>
            <Download className="w-4 h-4 me-2" /> {t('money.commissions.exportCsv')}
          </Button>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-card">
              <Filter className="w-4 h-4 me-2 text-muted-foreground" />
              <SelectValue placeholder={t('money.shared.status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('money.commissions.allStatuses')}</SelectItem>
              <SelectItem value="pending">{t('money.status.pending')}</SelectItem>
              <SelectItem value="part_paid">{t('money.status.part_paid')}</SelectItem>
              <SelectItem value="received">{t('money.status.received')}</SelectItem>
              <SelectItem value="overdue">{t('money.status.overdue')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {!isAgent && (
                <TableHead className="w-12 text-center">
                  <Checkbox 
                    checked={!!filteredCommissions && filteredCommissions.filter(c => remainingOf(c) > 0).length > 0 && selectedIds.size === filteredCommissions.filter(c => remainingOf(c) > 0).length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
              )}
              <TableHead>{t('money.commissions.policyAndClient')}</TableHead>
              <TableHead>{t('money.shared.insurer')}</TableHead>
              <TableHead className="text-end">{t('money.commissions.amountCur', { currency: getCurrency() })}</TableHead>
              <TableHead>{t('money.commissions.dates')}</TableHead>
              <TableHead>{t('money.shared.status')}</TableHead>
              {!isAgent && <TableHead className="text-end">{t('money.shared.action')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={isAgent ? 5 : 7} className="text-center py-8">{t('common.loading')}</TableCell></TableRow>
            ) : filteredCommissions?.length === 0 ? (
              <TableRow><TableCell colSpan={isAgent ? 5 : 7} className="text-center py-8 text-muted-foreground">{t('money.commissions.noRecords')}</TableCell></TableRow>
            ) : (
              filteredCommissions?.map((comm) => {
                const isOverdue = isOverdueRow(comm);
                const receivedOn = lastReceivedOn(comm);
                const remaining = remainingOf(comm);
                
                return (
                  <TableRow key={comm.id}>
                    {!isAgent && (
                      <TableCell className="text-center">
                        <Checkbox 
                          checked={remaining <= 0 ? true : selectedIds.has(comm.id)}
                          disabled={remaining <= 0}
                          onCheckedChange={() => toggleSelectRow(comm.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="font-medium">{comm.policy?.policy_number}</div>
                      <div className="text-xs text-muted-foreground">{comm.policy?.client?.name ?? '—'}</div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {comm.policy?.insurer?.name}
                    </TableCell>
                    <TableCell className="text-end font-medium">
                      {formatCurrency(comm.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{t('money.commissions.expectedOn', { date: formatDate(comm.expected_date) })}</div>
                      {receivedOn && <div className="text-xs text-emerald-600">{t('money.commissions.receivedOn', { date: formatDate(receivedOn) })}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {comm.status === 'part_paid' ? (
                          <Badge variant="warning">{t('money.status.part_paid')}</Badge>
                        ) : (
                          <Badge variant={getStatusColor(comm.status)} className="capitalize">{t(`money.status.${comm.status}`, { defaultValue: comm.status })}</Badge>
                        )}
                        {isOverdue && <Badge variant="destructive">{t('money.status.overdue')}</Badge>}
                      </div>
                      {comm.status === 'part_paid' && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatCurrency(comm.amount_received)} / {formatCurrency(comm.amount)}
                        </div>
                      )}
                      {!isAgent && ((comm.allocations ?? []) as any[]).length > 0 && (
                        <div className="text-xs mt-1 space-x-2">
                          {Array.from(new Map(((comm.allocations ?? []) as any[]).filter(a => a.receipt?.id).map(a => [a.receipt.id, a.receipt])).values()).map((r: any) => (
                            <Link key={r.id} href={`/receipts/${r.id}`} className="text-primary underline">
                              {t('money.commissions.receiptLink', { date: formatDate(r.received_on) })}
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    {!isAgent && (
                      <TableCell className="text-end">
                        {remaining > 0 && (
                          <Button size="sm" variant="outline" onClick={() => openReceiveDialog(comm)}>
                            <CheckCircle2 className="w-4 h-4 me-2" /> {t('money.shared.recordPayment')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!isAgent && (
      <Dialog open={!!payingComm} onOpenChange={(open) => !open && setPayingComm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('money.shared.recordPayment')}</DialogTitle>
            <DialogDescription>
              {t('money.commissions.paymentDescription', { policy: payingComm?.policy?.policy_number, insurer: payingComm?.policy?.insurer?.name, amount: payingComm ? formatCurrency(remainingOf(payingComm)) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('money.shared.dateReceived')}</label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('money.shared.amountReceivedCur', { currency: getCurrency() })}</label>
              <Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('money.shared.bankReferenceOptional')}</label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingComm(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleReceive} disabled={createReceipt.isPending || !((toCents(payAmount) ?? 0) > 0) || !payDate}>
              {createReceipt.isPending ? t('money.shared.saving') : t('money.shared.recordPayment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {!isAgent && (
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('money.commissions.recordPaymentSelected')}</DialogTitle>
            <DialogDescription>
              {t('money.commissions.bulkDescription', { count: selectedComms.length, total: formatCurrency(selectedTotal) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('money.shared.dateReceived')}</label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('money.shared.bankReferenceOptional')}</label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleBulkRecord} disabled={createReceipt.isPending || !sameInsurer || !payDate}>
              {createReceipt.isPending ? t('money.shared.saving') : t('money.shared.recordPayment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
}
