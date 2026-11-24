import { useMemo, useState } from 'react';
import { Plus, Search, Loader2, BellRing } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadAction, useLeads } from '@/hooks/leads';
import { useAgencyMembers } from '@/hooks/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadDrawer } from '@/components/leads/LeadDrawer';
import { LeadForm } from '@/components/leads/LeadForm';
import { StagePill } from '@/components/leads/StagePill';
import { FollowUpPicker } from '@/components/leads/FollowUpPicker';
import { LEAD_STAGES, followUpState, nextStages, stageLabel, type Lead, type LeadStage } from '@/lib/leads';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { todayNairobi } from '@/lib/subscription';

const ALL = '__all__';
type View = 'all' | LeadStage;
const VIEWS: View[] = ['all', ...LEAD_STAGES, 'lost'];

function LeadCard({ lead, today, onOpen, draggable, showStage }: {
  lead: Lead;
  today: string;
  onOpen: () => void;
  draggable?: boolean;
  showStage?: boolean;
}) {
  const fu = followUpState(lead, today);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lead-id', lead.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      aria-label={`${lead.full_name}, ${stageLabel(lead.stage)}`}
      className={cn(
        'cursor-pointer rounded-2xl border bg-card p-4 text-start shadow-panel transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        fu === 'overdue' && 'border-s-4 border-s-overdue',
        fu === 'due' && 'border-s-4 border-s-due',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{lead.full_name}</p>
          {lead.interest && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{lead.interest}</p>}
        </div>
        {lead.quoted_premium != null && (
          <span className="shrink-0 font-display text-sm font-semibold tabular-nums">{formatCurrency(lead.quoted_premium)}</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showStage && <StagePill stage={lead.stage} />}
        {lead.agent?.full_name && <span>{lead.agent.full_name}</span>}
        {lead.next_follow_up && fu !== 'none' && (
          <span className={cn(fu === 'overdue' && 'font-medium text-overdue', fu === 'due' && 'font-medium text-due')}>
            {fu === 'overdue' ? `Follow-up overdue (${formatDate(lead.next_follow_up)})` : fu === 'due' ? 'Follow up today' : `Follow up ${formatDate(lead.next_follow_up)}`}
          </span>
        )}
      </div>
      {lead.stage !== 'paid' && lead.stage !== 'lost' && (
        <div className="mt-3 border-t pt-3">
          <FollowUpPicker lead={lead} compact />
        </div>
      )}
    </div>
  );
}

/** Leads: pick a group (All, New, Contacted, …) and it fills the screen. */
export default function Leads() {
  const { isOwnerOrManager } = useAuth();
  const { data: leads, isLoading, error } = useLeads();
  const { data: members } = useAgencyMembers();
  const move = useLeadAction();
  const today = todayNairobi();

  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState(ALL);
  const [dueOnly, setDueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropTarget, setDropTarget] = useState<LeadStage | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (leads ?? [])
      .filter((l) =>
        (agent === ALL || l.assigned_agent_id === agent) &&
        (!dueOnly || ['due', 'overdue'].includes(followUpState(l, today))) &&
        (!s || [l.full_name, l.phone, l.email, l.interest].some((v) => (v ?? '').toLowerCase().includes(s))),
      )
      // nearest follow-up first, then most recent activity
      .sort((a, b) => (a.next_follow_up ?? '9999').localeCompare(b.next_follow_up ?? '9999'));
  }, [leads, agent, dueOnly, q, today]);

  const byStage = useMemo(() => {
    const m = new Map<LeadStage, Lead[]>();
    for (const l of filtered) m.set(l.stage, [...(m.get(l.stage) ?? []), l]);
    return m;
  }, [filtered]);

  const count = (v: View) => (v === 'all' ? filtered.filter((l) => l.stage !== 'lost').length : (byStage.get(v)?.length ?? 0));
  const value = (v: View) =>
    (v === 'all' ? filtered.filter((l) => l.stage !== 'lost' && l.stage !== 'paid') : byStage.get(v) ?? []).reduce((n, l) => n + Number(l.quoted_premium ?? 0), 0);
  const dueCount = (leads ?? []).filter((l) => ['due', 'overdue'].includes(followUpState(l, today))).length;
  const open = leads?.find((l) => l.id === openId) ?? null;
  const shown = view === 'all' ? [] : byStage.get(view) ?? [];

  const drop = (to: LeadStage, id: string) => {
    setDropTarget(null);
    const lead = leads?.find((l) => l.id === id);
    if (!lead || !(nextStages(lead.stage) as LeadStage[]).includes(to)) return;
    if (to === 'paid' && !window.confirm(`Mark ${lead.full_name} as paid? This closes the lead.`)) return;
    move.mutate({ rpc: 'move_lead', args: { p_lead_id: id, p_to: to } });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">People who might buy cover, from first call to paid policy.</p>
        <Button onClick={() => setAdding(true)}><Plus className="me-1.5 h-4 w-4" />Add lead</Button>
      </div>

      {/* Group switcher */}
      <div role="tablist" aria-label="Lead groups" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              'shrink-0 rounded-xl border px-4 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === v ? 'border-primary bg-primary text-primary-foreground shadow-panel' : 'bg-card hover:bg-muted',
            )}
          >
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{v === 'all' ? 'All' : stageLabel(v)}</span>
              <span className={cn('font-display text-lg font-bold tabular-nums', view !== v && 'text-muted-foreground')}>{count(v)}</span>
            </span>
            {v !== 'lost' && value(v) > 0 && (
              <span className={cn('block text-xs tabular-nums', view === v ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{formatCurrency(value(v))}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="ps-8" placeholder="Name, phone or what they want" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
        </div>
        {isOwnerOrManager && (
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="sm:w-52" aria-label="Agent"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All agents</SelectItem>
              {members?.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant={dueOnly ? 'default' : 'outline'} onClick={() => setDueOnly((v) => !v)} aria-pressed={dueOnly}>
          <BellRing className="me-1.5 h-4 w-4" />Follow-ups due{dueCount > 0 && <span className="ms-1.5 tabular-nums">{dueCount}</span>}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {move.error && <p className="text-sm text-destructive">{(move.error as Error).message}</p>}
      {isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />}

      {!isLoading && (leads?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="font-display text-lg font-semibold">Add your first lead</p>
          <p className="mt-1 text-sm text-muted-foreground">Add the people asking about cover, then log each call or WhatsApp and set when to follow up.</p>
          <Button className="mt-4" onClick={() => setAdding(true)}><Plus className="me-1.5 h-4 w-4" />Add lead</Button>
        </div>
      )}

      {/* All: board on wide screens, grouped list on phones */}
      {!isLoading && (leads?.length ?? 0) > 0 && view === 'all' && (
        <>
          <div className="hidden gap-3 lg:grid lg:grid-cols-5">
            {LEAD_STAGES.map((s) => (
              <div
                key={s}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(s); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((d) => (d === s ? null : d)); }}
                onDrop={(e) => { e.preventDefault(); drop(s, e.dataTransfer.getData('text/lead-id')); }}
                className={cn('min-h-48 space-y-3 rounded-2xl bg-muted/50 p-2.5', dropTarget === s && 'ring-2 ring-primary/50')}
              >
                <button type="button" onClick={() => setView(s)} className="flex w-full items-center justify-between rounded-lg px-1 pt-1 hover:underline">
                  <StagePill stage={s} />
                  <span className="text-xs tabular-nums text-muted-foreground">{byStage.get(s)?.length ?? 0}</span>
                </button>
                {(byStage.get(s) ?? []).map((l) => (
                  <LeadCard key={l.id} lead={l} today={today} onOpen={() => setOpenId(l.id)} draggable={s !== 'paid'} />
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-6 lg:hidden">
            {LEAD_STAGES.filter((s) => (byStage.get(s)?.length ?? 0) > 0).map((s) => (
              <section key={s} className="space-y-2">
                <button type="button" onClick={() => setView(s)} className="flex items-center gap-2">
                  <StagePill stage={s} />
                  <span className="text-xs tabular-nums text-muted-foreground">{byStage.get(s)?.length}</span>
                </button>
                {(byStage.get(s) ?? []).map((l) => <LeadCard key={l.id} lead={l} today={today} onOpen={() => setOpenId(l.id)} />)}
              </section>
            ))}
          </div>
        </>
      )}

      {/* One group: fills the screen */}
      {!isLoading && (leads?.length ?? 0) > 0 && view !== 'all' && (
        shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            No {stageLabel(view).toLowerCase()} leads{q || dueOnly || agent !== ALL ? ' match these filters' : ''}.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((l) => <LeadCard key={l.id} lead={l} today={today} onOpen={() => setOpenId(l.id)} />)}
          </div>
        )
      )}

      <LeadDrawer lead={open} onClose={() => setOpenId(null)} />
      <LeadForm open={adding} onOpenChange={setAdding} onSaved={(id) => setOpenId(id)} />
    </div>
  );
}
