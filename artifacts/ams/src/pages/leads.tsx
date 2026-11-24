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
import { LEAD_STAGES, followUpState, nextStages, stageLabel, type Lead, type LeadStage } from '@/lib/leads';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { todayNairobi } from '@/lib/subscription';

const ALL = '__all__';
type View = LeadStage;

function LeadCard({ lead, today, onOpen, draggable }: { lead: Lead; today: string; onOpen: () => void; draggable?: boolean }) {
  const fu = followUpState(lead, today);
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lead-id', lead.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'w-full rounded-xl border bg-card p-3 text-start shadow-panel transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        fu === 'overdue' && 'border-s-4 border-s-overdue',
        fu === 'due' && 'border-s-4 border-s-due',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{lead.full_name}</span>
        {lead.quoted_premium != null && (
          <span className="shrink-0 font-display text-sm tabular-nums">{formatCurrency(lead.quoted_premium)}</span>
        )}
      </div>
      {lead.interest && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{lead.interest}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {lead.agent?.full_name && <span>{lead.agent.full_name}</span>}
        {lead.next_follow_up && fu !== 'none' && (
          <span className={cn(fu === 'overdue' && 'font-medium text-overdue', fu === 'due' && 'font-medium text-due')}>
            {fu === 'overdue' ? 'Follow-up overdue' : fu === 'due' ? 'Follow up today' : `Follow up ${formatDate(lead.next_follow_up)}`}
          </span>
        )}
      </div>
    </button>
  );
}

/** Leads: a stage bar, a board (wide screens) or a stage list (phones), and the lead drawer. */
export default function Leads() {
  const { isOwnerOrManager } = useAuth();
  const { data: leads, isLoading, error } = useLeads();
  const { data: members } = useAgencyMembers();
  const move = useLeadAction();
  const today = todayNairobi();

  const [view, setView] = useState<View>('new');
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState(ALL);
  const [dueOnly, setDueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropTarget, setDropTarget] = useState<LeadStage | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (leads ?? []).filter((l) =>
      (agent === ALL || l.assigned_agent_id === agent) &&
      (!dueOnly || ['due', 'overdue'].includes(followUpState(l, today))) &&
      (!s || [l.full_name, l.phone, l.email, l.interest].some((v) => (v ?? '').toLowerCase().includes(s))),
    );
  }, [leads, agent, dueOnly, q, today]);

  const byStage = useMemo(() => {
    const m = new Map<LeadStage, Lead[]>();
    for (const l of filtered) m.set(l.stage, [...(m.get(l.stage) ?? []), l]);
    return m;
  }, [filtered]);

  const totals = (s: LeadStage) => {
    const list = byStage.get(s) ?? [];
    return { count: list.length, value: list.reduce((n, l) => n + Number(l.quoted_premium ?? 0), 0) };
  };
  const dueCount = (leads ?? []).filter((l) => ['due', 'overdue'].includes(followUpState(l, today))).length;
  const open = leads?.find((l) => l.id === openId) ?? null;

  const drop = (to: LeadStage, id: string) => {
    setDropTarget(null);
    const lead = leads?.find((l) => l.id === id);
    if (!lead || !(nextStages(lead.stage) as LeadStage[]).includes(to)) return;
    move.mutate({ rpc: 'move_lead', args: { p_lead_id: id, p_to: to } });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">People who might buy cover, from first call to paid policy.</p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="me-1.5 h-4 w-4" />Add lead</Button>
      </div>

      {/* Stage bar */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {[...LEAD_STAGES, 'lost' as const].map((s) => {
          const t = totals(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => setView(s)}
              aria-pressed={view === s}
              className={cn(
                'min-w-28 shrink-0 rounded-xl border px-3 py-2 text-start transition-colors md:flex-1',
                view === s ? 'border-primary bg-primary/10' : 'bg-card hover:bg-muted',
                s === 'lost' && 'md:max-w-32 md:flex-none',
              )}
            >
              <div className="text-xs text-muted-foreground">{stageLabel(s)}</div>
              <div className="font-display text-xl tabular-nums">{t.count}</div>
              {t.value > 0 && s !== 'lost' && <div className="truncate text-xs tabular-nums text-muted-foreground">{formatCurrency(t.value)}</div>}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="ps-8" placeholder="Name, phone or what they want" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isOwnerOrManager && (
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
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
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-display text-lg">No leads yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add the people asking about cover, then log each call or WhatsApp as you go.</p>
          <Button className="mt-4" onClick={() => setAdding(true)}><Plus className="me-1.5 h-4 w-4" />Add your first lead</Button>
        </div>
      )}

      {/* Board: wide screens, open stages + paid; lost shows as a list */}
      {!isLoading && (leads?.length ?? 0) > 0 && view !== 'lost' && (
        <div className="hidden gap-3 lg:grid lg:grid-cols-5">
          {LEAD_STAGES.map((s) => (
            <div
              key={s}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(s); }}
              onDragLeave={() => setDropTarget((d) => (d === s ? null : d))}
              onDrop={(e) => { e.preventDefault(); drop(s, e.dataTransfer.getData('text/lead-id')); }}
              className={cn('min-h-40 space-y-2 rounded-2xl bg-muted/40 p-2', dropTarget === s && 'ring-2 ring-primary/50')}
            >
              <div className="flex items-baseline justify-between px-1 pt-1">
                <StagePill stage={s} />
                <span className="text-xs tabular-nums text-muted-foreground">{totals(s).count}</span>
              </div>
              {(byStage.get(s) ?? []).map((l) => (
                <LeadCard key={l.id} lead={l} today={today} onOpen={() => setOpenId(l.id)} draggable={s !== 'paid'} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* List: phones and tablets (and Lost everywhere) */}
      {!isLoading && (leads?.length ?? 0) > 0 && (
        <div className={cn('space-y-2', view !== 'lost' && 'lg:hidden')}>
          {(byStage.get(view) ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No {stageLabel(view).toLowerCase()} leads{q || dueOnly || agent !== ALL ? ' match these filters' : ''}.</p>
          ) : (
            (byStage.get(view) ?? []).map((l) => <LeadCard key={l.id} lead={l} today={today} onOpen={() => setOpenId(l.id)} />)
          )}
        </div>
      )}

      <LeadDrawer lead={open} onClose={() => setOpenId(null)} />
      <LeadForm open={adding} onOpenChange={setAdding} onSaved={(id) => setOpenId(id)} />
    </div>
  );
}
