import { getCurrency } from '@/lib/money';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { format } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PolicyCommissionFields } from '@/components/PolicyCommissionFields';
import { useToast } from '@/hooks/use-toast';
import { useInsurers, useProductLines } from '@/hooks/queries';
import { useLogContact, useMarkLost, usePolicyForRenewal, useRecordQuote, useRenewPolicy } from '@/hooks/renewals';
import { commissionFields, refineCommission, withCommissionColumns } from '@/lib/policy-form';
import { fromCents, toCents } from '@/lib/reconcile';
import {
  LOST_REASONS,
  RENEWAL_CHANNELS,
  channelLabel,
  defaultRenewalDates,
  lostReasonLabel,
} from '@/lib/renewals';
import type { LostReason, RenewalChannel, RenewalRow } from '@/lib/types';

export type RenewalAction = 'contact' | 'quote' | 'lost' | 'renew';

const today = () => format(new Date(), 'yyyy-MM-dd');

function useErrorToast() {
  const { toast } = useToast();
  const { t } = useTranslation();
  return (err: unknown) =>
    toast({
      title: t('policies.couldNotSave'),
      description: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err),
      variant: 'destructive',
    });
}

interface DialogProps {
  row: RenewalRow | null;
  onClose: () => void;
}

function ContactDialog({ row, onClose }: DialogProps) {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<RenewalChannel>('phone');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const logContact = useLogContact();
  const { toast } = useToast();
  const onError = useErrorToast();

  useEffect(() => {
    if (row) {
      setChannel('phone');
      setDate(today());
      setNote('');
    }
  }, [row]);

  const save = () => {
    if (!row) return;
    logContact.mutate(
      { policyId: row.policy_id, channel, occurredOn: date, note },
      {
        onSuccess: () => {
          toast({ title: t('policies.contactLogged') });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('policies.logContact')}</DialogTitle>
          <DialogDescription>
            {row?.client_name ?? t('policies.clientFallback')} · {row?.policy_number}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('policies.channelLabel')}</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as RenewalChannel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RENEWAL_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{channelLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-date">{t('policies.date')}</Label>
            <Input id="contact-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-note">{t('policies.noteOptional')}</Label>
            <Textarea id="contact-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!date || logContact.isPending}>
            {logContact.isPending ? t('policies.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuoteDialog({ row, onClose }: DialogProps) {
  const { t } = useTranslation();
  const { data: insurers } = useInsurers();
  const [insurerId, setInsurerId] = useState('');
  const [premium, setPremium] = useState('');
  const [note, setNote] = useState('');
  const recordQuote = useRecordQuote();
  const { toast } = useToast();
  const onError = useErrorToast();

  useEffect(() => {
    if (row) {
      setInsurerId(row.quoted_insurer_id ?? row.insurer_id);
      setPremium(String(row.quoted_premium ?? row.premium_amount ?? ''));
      setNote('');
    }
  }, [row]);

  const premiumCents = toCents(premium);
  const valid = !!insurerId && premiumCents !== null && premiumCents > 0;

  const save = () => {
    if (!row || premiumCents === null) return;
    recordQuote.mutate(
      { policyId: row.policy_id, insurerId, premium: fromCents(premiumCents), note },
      {
        onSuccess: () => {
          toast({ title: t('policies.quoteRecorded') });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('policies.recordQuote')}</DialogTitle>
          <DialogDescription>
            {row?.client_name ?? t('policies.clientFallback')} · {row?.policy_number}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('policies.insurer')}</Label>
            <Select value={insurerId} onValueChange={setInsurerId}>
              <SelectTrigger><SelectValue placeholder={t('policies.pickInsurer')} /></SelectTrigger>
              <SelectContent>
                {(insurers ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quote-premium">{t('policies.premium', { currency: getCurrency() })}</Label>
            <Input id="quote-premium" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quote-note">{t('policies.noteOptional')}</Label>
            <Textarea id="quote-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!valid || recordQuote.isPending}>
            {recordQuote.isPending ? t('policies.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LostDialog({ row, onClose }: DialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<LostReason | ''>('');
  const [note, setNote] = useState('');
  const markLost = useMarkLost();
  const { toast } = useToast();
  const onError = useErrorToast();

  useEffect(() => {
    if (row) {
      setReason('');
      setNote('');
    }
  }, [row]);

  const save = () => {
    if (!row || !reason) return;
    markLost.mutate(
      { policyId: row.policy_id, reason, note },
      {
        onSuccess: () => {
          toast({ title: t('policies.markedLost') });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('policies.markLost')}</DialogTitle>
          <DialogDescription>
            {row?.client_name ?? t('policies.clientFallback')} · {row?.policy_number}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('policies.reason')}</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as LostReason)}>
              <SelectTrigger><SelectValue placeholder={t('policies.pickReason')} /></SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{lostReasonLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lost-note">{t('policies.noteOptional')}</Label>
            <Textarea id="lost-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={save} disabled={!reason || markLost.isPending}>
            {markLost.isPending ? t('policies.saving') : t('policies.markLost')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const makeRenewSchema = (t: TFunction) =>
  z
    .object({
      policy_number: z.string().trim().min(1, t('policies.enterPolicyNumber')),
      insurer_id: z.string().min(1, t('policies.required')),
      product_line_id: z.string().min(1, t('policies.required')),
      premium_amount: z.coerce.number().positive(t('policies.enterPremium')),
      commission_rate: z.coerce.number().min(0).max(100),
      start_date: z.string().min(1, t('policies.required')),
      expiry_date: z.string().min(1, t('policies.required')),
      notes: z.string().optional(),
      ...commissionFields,
    })
    .superRefine((v, ctx) => {
      refineCommission(v, ctx);
      if (v.start_date && v.expiry_date && v.expiry_date <= v.start_date) {
        ctx.addIssue({ code: 'custom', path: ['expiry_date'], message: t('policies.expiryAfterStart') });
      }
    });

type RenewValues = z.input<ReturnType<typeof makeRenewSchema>>;

function RenewDialog({ row, onClose }: DialogProps) {
  const { t } = useTranslation();
  const renewSchema = useMemo(() => makeRenewSchema(t), [t]);
  const { data: old } = usePolicyForRenewal(row?.policy_id);
  const { data: insurers } = useInsurers();
  const { data: productLines } = useProductLines();
  const renew = useRenewPolicy();
  const { toast } = useToast();
  const onError = useErrorToast();

  const form = useForm<RenewValues>({ resolver: zodResolver(renewSchema) });

  // Pre-fill once the old policy has loaded
  useEffect(() => {
    if (!row || !old || old.id !== row.policy_id) return;
    const dates = defaultRenewalDates(old.expiry_date);
    form.reset({
      policy_number: old.policy_number,
      insurer_id: row.quoted_insurer_id ?? old.insurer_id,
      product_line_id: old.product_line_id,
      premium_amount: row.quoted_premium ?? old.premium_amount,
      commission_rate: old.commission_rate,
      start_date: dates.start,
      expiry_date: dates.expiry,
      notes: '',
      commission_basis: old.commission_basis,
      premium_frequency: old.premium_frequency ?? '',
      instalment_premium: old.instalment_premium != null ? String(old.instalment_premium) : '',
      renewal_commission_rate: old.renewal_commission_rate != null ? String(old.renewal_commission_rate) : '',
    });
  }, [row, old, form]);

  const onSubmit = (values: RenewValues) => {
    if (!row) return;
    const parsed = renewSchema.parse(values);
    const cols = withCommissionColumns(parsed);
    renew.mutate(
      {
        policyId: row.policy_id,
        next: {
          policy_number: cols.policy_number.trim(),
          insurer_id: cols.insurer_id,
          product_line_id: cols.product_line_id,
          premium_amount: cols.premium_amount,
          commission_rate: cols.commission_rate,
          commission_basis: cols.commission_basis,
          premium_frequency: cols.premium_frequency,
          instalment_premium: cols.instalment_premium,
          renewal_commission_rate: cols.renewal_commission_rate,
          start_date: cols.start_date,
          expiry_date: cols.expiry_date,
          notes: cols.notes || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: t('policies.renewed'), description: t('policies.newPolicyCreated', { number: cols.policy_number.trim() }) });
          onClose();
        },
        onError,
      },
    );
  };

  const ready = !!old && old.id === row?.policy_id;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('policies.renewTitle')}</DialogTitle>
          <DialogDescription>
            {t('policies.renewDescription', { client: row?.client_name ?? t('policies.thisClient'), policy: row?.policy_number })}
          </DialogDescription>
        </DialogHeader>
        {!ready ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t('policies.loadingPolicy')}</div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="policy_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('policies.policyNumber')}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="insurer_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.insurer')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(insurers ?? []).map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="product_line_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.productLine')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {(productLines ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="premium_amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.premium', { currency: getCurrency() })}</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} value={field.value as number | string ?? ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="commission_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.commissionRate')}</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} value={field.value as number | string ?? ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="start_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.startDate')}</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiry_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.expiryDate')}</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <PolicyCommissionFields form={form} productLines={productLines} keepInitialBasis />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('policies.notesOptional')}</FormLabel>
                    <FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={renew.isPending}>
                  {renew.isPending ? t('policies.renewing') : t('policies.renew')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Renders the dialog for the chosen action; only one is open at a time. */
export function RenewalActionDialogs({
  action,
  row,
  onClose,
}: {
  action: RenewalAction | null;
  row: RenewalRow | null;
  onClose: () => void;
}) {
  return (
    <>
      <ContactDialog row={action === 'contact' ? row : null} onClose={onClose} />
      <QuoteDialog row={action === 'quote' ? row : null} onClose={onClose} />
      <LostDialog row={action === 'lost' ? row : null} onClose={onClose} />
      <RenewDialog row={action === 'renew' ? row : null} onClose={onClose} />
    </>
  );
}
