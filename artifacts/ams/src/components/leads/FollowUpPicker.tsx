import { CalendarPlus, X } from 'lucide-react';
import { useLeadAction } from '@/hooks/leads';
import { quickFollowUps, type Lead } from '@/lib/leads';
import { todayNairobi } from '@/lib/subscription';
import { cn, formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

/**
 * One-tap follow-up dates (Today / Tomorrow / In 3 days / Next week / pick a date).
 * Clicks don't bubble, so it can sit inside a clickable card.
 */
export function FollowUpPicker({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const act = useLeadAction();
  const { toast } = useToast();
  const today = todayNairobi();
  const set = (date: string | null) =>
    act.mutate(
      { rpc: 'set_lead_follow_up', args: { p_lead_id: lead.id, p_date: date } },
      {
        onSuccess: () => toast({ title: date ? `Follow up ${date === today ? 'today' : `on ${formatDate(date)}`}` : 'Follow-up cleared' }),
        onError: (e) => toast({ title: 'Could not set the follow-up', description: (e as Error).message, variant: 'destructive' }),
      },
    );

  if (lead.stage === 'paid' || lead.stage === 'lost') return null;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1')}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="group"
      aria-label={`Set a follow-up for ${lead.full_name}`}
    >
      {!compact && <span className="me-1 text-xs text-muted-foreground">Follow up</span>}
      {quickFollowUps(today).map((q) => (
        <button
          key={q.label}
          type="button"
          disabled={act.isPending}
          onClick={() => set(q.date)}
          aria-pressed={lead.next_follow_up === q.date}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            lead.next_follow_up === q.date ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
          )}
        >
          {q.label}
        </button>
      ))}
      <label className="relative inline-flex cursor-pointer items-center rounded-full border bg-card px-2 py-0.5 text-xs hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
        <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Pick a date</span>
        <input
          type="date"
          min={today}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => e.target.value && set(e.target.value)}
          aria-label="Pick a follow-up date"
        />
      </label>
      {lead.next_follow_up && (
        <button
          type="button"
          onClick={() => set(null)}
          aria-label="Clear the follow-up"
          title="Clear the follow-up"
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
