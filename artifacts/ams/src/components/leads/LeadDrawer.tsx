import { useEffect, useState } from 'react';
import { Link } from 'wouter';
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
import { CHANNELS, LOST_REASONS, SOURCES, followUpState, nextStages, stageLabel, type Lead, type LeadActivity, type LeadChannel } from '@/lib/leads';
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

function describe(a: LeadActivity): string {
  switch (a.kind) {
    case 'contact':
      return CHANNELS.find((c) => c.value === a.channel)?.label ?? 'Contact';
    case 'stage':
      return `Moved to ${a.to_stage ? stageLabel(a.to_stage) : '?'}`;
    case 'lost':
      return 'Marked lost';
    case 'reopened':
      return `Reopened at ${a.to_stage ? stageLabel(a.to_stage) : '?'}`;
    case 'converted':
      return 'Client and policy created';
    case 'assigned':
      return 'Reassigned';
  }
}

type Panel = null | 'contact' | 'lost' | 'convert';

/** One lead: details, stage moves, contact log, conversion and its full timeline. */
export function LeadDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
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
              <SheetDescription>{lead.interest ?? 'No details yet'}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap gap-2">
              {lead.phone && (
                <>
                  <Button size="sm" variant="outline" asChild><a href={`tel:${lead.phone}`}><Phone className="me-1.5 h-4 w-4" />Call</a></Button>
                  <Button size="sm" variant="outline" asChild><a href={waLink(lead.phone)} target="_blank" rel="noreferrer"><MessageCircle className="me-1.5 h-4 w-4" />WhatsApp</a></Button>
                </>
              )}
              {lead.email && (
                <Button size="sm" variant="outline" asChild><a href={`mailto:${lead.email}`}><Mail className="me-1.5 h-4 w-4" />Email</a></Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="me-1.5 h-4 w-4" />Edit</Button>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-muted/50 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Figure discussed</dt>
                <dd className="font-display text-lg tabular-nums">{lead.quoted_premium != null ? formatCurrency(lead.quoted_premium) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Next follow-up</dt>
                <dd className={cn('text-lg font-display', fu === 'overdue' && 'text-overdue', fu === 'due' && 'text-due')}>
                  {lead.next_follow_up ? formatDate(lead.next_follow_up) : '—'}
                  {fu === 'overdue' && <span className="ms-1.5 text-xs font-sans font-medium">overdue</span>}
                  {fu === 'due' && <span className="ms-1.5 text-xs font-sans font-medium">today</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd>{lead.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Product line</dt>
                <dd>{lead.product_line?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Came from</dt>
                <dd>{SOURCES.find((s) => s.value === lead.source)?.label ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Added</dt>
                <dd>{formatDate(lead.created_at)}</dd>
              </div>
              {lead.stage === 'lost' && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Lost because</dt>
                  <dd>{LOST_REASONS.find((r) => r.value === lead.lost_reason)?.label ?? '—'}</dd>
                </div>
              )}
              {lead.notes && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Notes</dt>
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
                  <Button size="sm" onClick={() => setPanel(panel === 'contact' ? null : 'contact')}>Log contact</Button>
                  {nextStages(lead.stage).map((s) => (
                    <Button key={s} size="sm" variant="outline" disabled={act.isPending} onClick={() => run('move_lead', { p_lead_id: lead.id, p_to: s })}>
                      {stageLabel(s)}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" className="text-overdue" onClick={() => setPanel(panel === 'lost' ? null : 'lost')}>Lost</Button>
                </div>
              )}
              {lead.stage === 'paid' && !lead.policy_id && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPanel('convert')}>Create client &amp; policy</Button>
                  <Button size="sm" variant="ghost" onClick={() => run('reopen_lead', { p_lead_id: lead.id })}>Reopen</Button>
                </div>
              )}
              {lead.stage === 'lost' && (
                <Button size="sm" variant="outline" onClick={() => run('reopen_lead', { p_lead_id: lead.id })}>Reopen</Button>
              )}
              {lead.policy_id && (
                <p className="rounded-lg border border-money/30 bg-money/10 p-3 text-sm">
                  Converted.{' '}
                  {lead.client_id && <Link href={`/clients/${lead.client_id}`} className="font-medium underline underline-offset-2">Open the client</Link>}
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
                  <Label className="text-xs text-muted-foreground">Agent</Label>
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
                    if (window.confirm(`Delete ${lead.full_name} and their contact history? This can't be undone.`)) {
                      run('delete_lead', { p_lead_id: lead.id }, onClose);
                    }
                  }}
                >
                  <Trash2 className="me-1.5 h-4 w-4" />Delete
                </Button>
              </section>
            )}

            {/* Timeline */}
            <section className="mt-6">
              <h3 className="font-display text-base font-semibold">History</h3>
              {isLoading ? (
                <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" />
              ) : (activities?.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No contacts yet. Log the first one when you reach them.</p>
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
                        <span className="font-medium">{describe(a)}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(a.kind === 'contact' ? a.occurred_on : a.created_at)}</span>
                      </div>
                      {a.premium != null && <div className="tabular-nums">Figure: <span className="font-medium">{formatCurrency(a.premium)}</span></div>}
                      {a.next_follow_up && <div className="text-muted-foreground">Follow up {formatDate(a.next_follow_up)}</div>}
                      {a.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{a.note}</p>}
                      {a.author?.full_name && <div className="text-xs text-muted-foreground">by {a.author.full_name}</div>}
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
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How you contacted them">
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
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="c-date">When</Label>
          <Input id="c-date" type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-figure">Figure discussed</Label>
          <Input id="c-figure" type="number" min={0} step="0.01" inputMode="decimal" value={figure} onChange={(e) => setFigure(e.target.value)} placeholder="Optional" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-follow">Follow up on</Label>
          <Input id="c-follow" type="date" min={todayNairobi()} value={follow} onChange={(e) => setFollow(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="c-note">What was said</Label>
        <Textarea id="c-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={act.isPending}>
          {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Save contact
        </Button>
      </div>
    </form>
  );
}

function LostForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
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
        <Label>Why was it lost?</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger><SelectValue placeholder="Pick a reason" /></SelectTrigger>
          <SelectContent>
            {LOST_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Textarea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" variant="destructive" disabled={act.isPending}>Mark lost</Button>
      </div>
    </form>
  );
}

function ConvertForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
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
        Creates the client {lead.full_name} and a pending policy for {lead.agent?.full_name ?? 'the agent'}. Commissions and renewals pick it up from there.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Client type</Label>
          <Select value={f.client_type} onValueChange={set('client_type')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="corporate">Corporate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-number">Policy number</Label>
          <Input id="cv-number" value={f.policy_number} onChange={(e) => set('policy_number')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label>Insurer</Label>
          <Select value={f.insurer_id} onValueChange={set('insurer_id')}>
            <SelectTrigger><SelectValue placeholder="Pick an insurer" /></SelectTrigger>
            <SelectContent>{insurers?.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Product line</Label>
          <Select value={f.product_line_id} onValueChange={set('product_line_id')}>
            <SelectTrigger><SelectValue placeholder="Pick a product line" /></SelectTrigger>
            <SelectContent>{productLines?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-premium">Premium</Label>
          <Input id="cv-premium" type="number" min={0} step="0.01" value={f.premium_amount} onChange={(e) => set('premium_amount')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-rate">Commission rate (%)</Label>
          <Input id="cv-rate" type="number" min={0} max={100} step="0.01" value={f.commission_rate} onChange={(e) => set('commission_rate')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-start">Starts</Label>
          <Input id="cv-start" type="date" value={f.start_date} onChange={(e) => set('start_date')(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cv-end">Expires</Label>
          <Input id="cv-end" type="date" value={f.expiry_date} onChange={(e) => set('expiry_date')(e.target.value)} required />
        </div>
      </div>
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={act.isPending}>
          {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Create client &amp; policy
        </Button>
      </div>
    </form>
  );
}
