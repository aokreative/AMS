import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Loader2, MessageCircle, Phone, Mail, Pencil, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadAction, useLeadActivities } from '@/hooks/leads';
import { useInsurers, useProductLines } from '@/hooks/queries';
import { useAgencyMembers } from '@/hooks/team';
import { CHANNELS, LOST_REASONS, followUpState, nextStages, type Lead, type LeadActivity, type LeadChannel } from '@/lib/leads';
import { formatCurrency, formatDate } from '@/lib/utils';
import { todayNairobi } from '@/lib/subscription';
import { cn } from '@/lib/utils';
import { LeadForm } from './LeadForm';
import { StagePill } from './StagePill';
import { FollowUpPicker } from './FollowUpPicker';

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}`;
}

function describe(a: LeadActivity, t: TFunction): string {
  const stage = a.to_stage ? t(`workspace.stage.${a.to_stage}`) : '?';
  switch (a.kind) {
    case 'contact':
      return CHANNELS.some((c) => c.value === a.channel) ? t(`workspace.channel.${a.channel}`) : t('workspace.channel.contact');
    case 'stage':
      return t('workspace.drawer.movedTo', { stage });
    case 'lost':
      return t('workspace.drawer.markedLost');
    case 'reopened':
      return t('workspace.drawer.reopenedAt', { stage });
    case 'converted':
      return t('workspace.drawer.converted2');
    case 'assigned':
      return t('workspace.drawer.reassigned');
  }
}

type Panel = null | 'contact' | 'lost' | 'convert';

/** One lead: details, stage moves, contact log, conversion and its full timeline. */
export function LeadDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { isOwnerOrManager } = useAuth();
  const { data: activities, isLoading } = useLeadActivities(lead?.id);
  const { data: members } = useAgencyMembers();
  const act = useLeadAction();
  const [panel, setPanel] = useState<Panel>(null);
  const [editing, setEditing] = useState(false);
  const today = todayNairobi();

  useEffect(() => {
    setPanel(null);
    act.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  const run = (rpc: Parameters<typeof act.mutate>[0]['rpc'], args: Record<string, unknown>, after?: () => void) =>
    act.mutate({ rpc, args }, { onSuccess: () => { setPanel(null); after?.(); } });

  const open = !!lead && lead.stage !== 'paid' && lead.stage !== 'lost';
  const fu = lead ? followUpState(lead, today) : 'none';

  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {lead && (
          <>
            <SheetHeader className="text-start">
              <div className="flex items-center gap-2">
                <StagePill stage={lead.stage} />
                {lead.agent?.full_name && <span className="text-xs text-muted-foreground">{lead.agent.full_name}</span>}
              </div>
              <SheetTitle className="font-display text-2xl">{lead.full_name}</SheetTitle>
              <SheetDescription>{lead.interest ?? t('workspace.drawer.noDetails')}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap gap-2">
              {lead.phone && (
                <>
                  <Button size="sm" variant="outline" asChild><a href={`tel:${lead.phone}`}><Phone className="me-1.5 h-4 w-4" />{t('workspace.channel.call')}</a></Button>
                  <Button size="sm" variant="outline" asChild><a href={waLink(lead.phone)} target="_blank" rel="noreferrer"><MessageCircle className="me-1.5 h-4 w-4" />{t('workspace.channel.whatsapp')}</a></Button>
                </>
              )}
              {lead.email && (
                <Button size="sm" variant="outline" asChild><a href={`mailto:${lead.email}`}><Mail className="me-1.5 h-4 w-4" />{t('workspace.channel.email')}</a></Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="me-1.5 h-4 w-4" />{t('workspace.drawer.edit')}</Button>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-muted/50 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t('workspace.drawer.figure')}</dt>
                <dd className="font-display text-lg tabular-nums">{lead.quoted_premium != null ? formatCurrency(lead.quoted_premium) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('workspace.drawer.nextFollowUp')}</dt>
                <dd className={cn('text-lg font-display', fu === 'overdue' && 'text-overdue', fu === 'due' && 'text-due')}>
                  {lead.next_follow_up ? formatDate(lead.next_follow_up) : '—'}
                  {fu === 'overdue' && <span className="ms-1.5 text-xs font-sans font-medium">{t('workspace.drawer.overdue')}</span>}
                  {fu === 'due' && <span className="ms-1.5 text-xs font-sans font-medium">{t('workspace.drawer.today')}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('workspace.drawer.phone')}</dt>
                <dd>{lead.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('workspace.form.productLine')}</dt>
                <dd>{lead.product_line?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('workspace.drawer.cameFrom')}</dt>
                <dd>{lead.source ? t(`workspace.source.${lead.source}`) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('workspace.drawer.added')}</dt>
                <dd>{formatDate(lead.created_at)}</dd>
              </div>
              {lead.stage === 'lost' && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('workspace.drawer.lostBecause')}</dt>
                  <dd>{lead.lost_reason ? t(`workspace.reason.${lead.lost_reason}`) : '—'}</dd>
                </div>
              )}
              {lead.notes && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('workspace.drawer.notes')}</dt>
                  <dd className="whitespace-pre-wrap">{lead.notes}</dd>
                </div>
              )}
            </dl>

            {open && (
              <div className="mt-4">
                <FollowUpPicker lead={lead} />
              </div>
            )}

            {/* Moves */}
            <section className="mt-5 space-y-2">
              {open && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPanel(panel === 'contact' ? null : 'contact')}>{t('workspace.drawer.logContact')}</Button>
                  {nextStages(lead.stage).map((s) => (
                    <Button key={s} size="sm" variant="outline" disabled={act.isPending} onClick={() => run('move_lead', { p_lead_id: lead.id, p_to: s })}>
                      {t(`workspace.stage.${s}`)}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" className="text-overdue" onClick={() => setPanel(panel === 'lost' ? null : 'lost')}>{t('workspace.drawer.lost')}</Button>
                </div>
              )}
              {lead.stage === 'paid' && !lead.policy_id && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPanel('convert')}>{t('workspace.drawer.createClientPolicy')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => run('reopen_lead', { p_lead_id: lead.id })}>{t('workspace.drawer.reopen')}</Button>
                </div>
              )}
              {lead.stage === 'lost' && (
                <Button size="sm" variant="outline" onClick={() => run('reopen_lead', { p_lead_id: lead.id })}>{t('workspace.drawer.reopen')}</Button>
              )}
              {lead.policy_id && (
                <p className="rounded-lg border border-money/30 bg-money/10 p-3 text-sm">
                  {t('workspace.drawer.converted')}{' '}
                  {lead.client_id && <Link href={`/clients/${lead.client_id}`} className="font-medium underline underline-offset-2">{t('workspace.drawer.openClient')}</Link>}
                </p>
              )}
              {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
            </section>

            {panel === 'contact' && <ContactForm lead={lead} onDone={() => setPanel(null)} />}
            {panel === 'lost' && <LostForm lead={lead} onDone={() => setPanel(null)} />}
            {panel === 'convert' && <ConvertForm lead={lead} onDone={() => setPanel(null)} />}

            {isOwnerOrManager && (
              <section className="mt-5 flex flex-wrap items-end gap-2 border-t pt-4">
                <div className="grid min-w-48 flex-1 gap-1.5">
                  <Label className="text-xs text-muted-foreground">{t('workspace.drawer.agent')}</Label>
                  <Select value={lead.assigned_agent_id} onValueChange={(v) => run('assign_lead', { p_lead_id: lead.id, p_agent_id: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {members?.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-overdue"
                  onClick={() => {
                    if (window.confirm(t('workspace.drawer.deleteConfirm', { name: lead.full_name }))) {
                      run('delete_lead', { p_lead_id: lead.id }, onClose);
                    }
                  }}
                >
                  <Trash2 className="me-1.5 h-4 w-4" />{t('workspace.drawer.delete')}
                </Button>
              </section>
            )}

            {/* Timeline */}
            <section className="mt-6">
              <h3 className="font-display text-base font-semibold">{t('workspace.drawer.history')}</h3>
              {isLoading ? (
                <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" />
              ) : (activities?.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('workspace.drawer.noHistory')}</p>
              ) : (
                <ol className="relative mt-3 space-y-4 border-s border-border ps-5">
                  {activities!.map((a) => (
                    <li key={a.id} className="relative text-sm">
                      <span
                        className={cn(
                          'absolute -start-[1.6rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background',
                          a.kind === 'contact' ? 'bg-primary' : a.kind === 'lost' ? 'bg-overdue' : a.kind === 'converted' ? 'bg-money' : 'bg-muted-foreground/50',
                        )}
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="font-medium">{describe(a, t)}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(a.kind === 'contact' ? a.occurred_on : a.created_at)}</span>
                      </div>
                      {a.premium != null && <div className="tabular-nums">{t('workspace.drawer.figureLabel')} <span className="font-medium">{formatCurrency(a.premium)}</span></div>}
                      {a.next_follow_up && <div className="text-muted-foreground">{t('workspace.drawer.followUpOn', { date: formatDate(a.next_follow_up) })}</div>}
                      {a.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{a.note}</p>}
                      {a.author?.full_name && <div className="text-xs text-muted-foreground">{t('workspace.drawer.by', { name: a.author.full_name })}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <LeadForm open={editing} onOpenChange={setEditing} lead={lead} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ContactForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { t } = useTranslation();
  const act = useLeadAction();
  const [channel, setChannel] = useState<LeadChannel>('call');
  const [date, setDate] = useState(todayNairobi());
  const [figure, setFigure] = useState('');
  const [follow, setFollow] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        act.mutate(
          {
            rpc: 'log_lead_contact',
            args: {
              p_lead_id: lead.id,
              p_occurred_on: date,
              p_channel: channel,
              p_note: note,
              p_premium: figure.trim() === '' ? null : Number(figure),
              p_next_follow_up: follow || null,
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('workspace.drawer.howContacted')}>
        {CHANNELS.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={channel === c.value}
            onClick={() => setChannel(c.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              channel === c.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {t(`workspace.channel.${c.value}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="c-date">{t('workspace.drawer.when')}</Label>
          <Input id="c-date" type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-figure">{t('workspace.drawer.figure')}</Label>
          <Input id="c-figure" type="number" min={0} step="0.01" inputMode="decimal" value={figure} onChange={(e) => setFigure(e.target.value)} placeholder={t('workspace.drawer.optional')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-follow">{t('workspace.drawer.followUpDate')}</Label>
          <Input id="c-follow" type="date" min={todayNairobi()} value={follow} onChange={(e) => setFollow(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="c-note">{t('workspace.drawer.whatWasSaid')}</Label>
        <Textarea id="c-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" size="sm" disabled={act.isPending}>
          {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t('workspace.drawer.saveContact')}
        </Button>
      </div>
    </form>
  );
}

function LostForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { t } = useTranslation();
  const act = useLeadAction();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border border-overdue/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        act.mutate({ rpc: 'mark_lead_lost', args: { p_lead_id: lead.id, p_reason: reason || null, p_note: note } }, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-1.5">
        <Label>{t('workspace.drawer.whyLost')}</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger><SelectValue placeholder={t('workspace.drawer.pickReason')} /></SelectTrigger>
          <SelectContent>
            {LOST_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{t(`workspace.reason.${r.value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Textarea rows={2} placeholder={t('workspace.drawer.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" size="sm" variant="destructive" disabled={act.isPending}>{t('workspace.drawer.markLost')}</Button>
      </div>
    </form>
  );
}

function ConvertForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { t } = useTranslation();
  const act = useLeadAction();
  const { data: insurers } = useInsurers();
  const { data: productLines } = useProductLines();
  const today = todayNairobi();
  const nextYear = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const [f, setF] = useState({
    client_type: 'individual',
    insurer_id: lead.insurer_id ?? '',
    product_line_id: lead.product_line_id ?? '',
    policy_number: '',
    premium_amount: lead.quoted_premium != null ? String(lead.quoted_premium) : '',
    commission_rate: '',
    start_date: today,
    expiry_date: nextYear,
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border border-money/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        act.mutate({ rpc: 'convert_lead', args: { p_lead_id: lead.id, p: f } }, { onSuccess: onDone });
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('workspace.drawer.convertIntro', { name: lead.full_name, agent: lead.agent?.full_name ?? t('workspace.drawer.theAgent') })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>{t('workspace.drawer.clientType')}</Label>
          <Select value={f.client_type} onValueChange={set('client_type')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">{t('workspace.drawer.individual')}</SelectItem>
              <SelectItem value="corporate">{t('workspace.drawer.corporate')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-number">{t('workspace.drawer.policyNumber')}</Label>
          <Input id="cv-number" value={f.policy_number} onChange={(e) => set('policy_number')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label>{t('workspace.drawer.insurer')}</Label>
          <Select value={f.insurer_id} onValueChange={set('insurer_id')}>
            <SelectTrigger><SelectValue placeholder={t('workspace.drawer.pickInsurer')} /></SelectTrigger>
            <SelectContent>{insurers?.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('workspace.form.productLine')}</Label>
          <Select value={f.product_line_id} onValueChange={set('product_line_id')}>
            <SelectTrigger><SelectValue placeholder={t('workspace.drawer.pickProductLine')} /></SelectTrigger>
            <SelectContent>{productLines?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-premium">{t('workspace.drawer.premium')}</Label>
          <Input id="cv-premium" type="number" min={0} step="0.01" value={f.premium_amount} onChange={(e) => set('premium_amount')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-rate">{t('workspace.drawer.commissionRate')}</Label>
          <Input id="cv-rate" type="number" min={0} max={100} step="0.01" value={f.commission_rate} onChange={(e) => set('commission_rate')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-start">{t('workspace.drawer.starts')}</Label>
          <Input id="cv-start" type="date" value={f.start_date} onChange={(e) => set('start_date')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-end">{t('workspace.drawer.expires')}</Label>
          <Input id="cv-end" type="date" value={f.expiry_date} onChange={(e) => set('expiry_date')(e.target.value)} required />
        </div>
      </div>
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" size="sm" disabled={act.isPending}>
          {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t('workspace.drawer.createClientPolicy')}
        </Button>
      </div>
    </form>
  );
}
