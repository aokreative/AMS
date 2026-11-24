import { useMemo } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarClock, PhoneCall } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/leads';
import { supabase } from '@/lib/supabase';
import { buildNotifications, type Urgency } from '@/lib/notifications';
import { todayNairobi } from '@/lib/subscription';
import { formatDate, cn } from '@/lib/utils';

const WHEN: Record<Urgency, string> = { overdue: 'Overdue', today: 'Today', soon: 'Soon', later: 'Coming up' };
const TONE: Record<Urgency, string> = {
  overdue: 'bg-overdue/12 text-overdue',
  today: 'bg-due/15 text-due',
  soon: 'bg-primary/10 text-primary',
  later: 'bg-muted text-muted-foreground',
};

/** Bell in the top bar: follow-ups and renewals, nearest due first. */
export function NotificationBell() {
  const { agency, session } = useAuth();
  const { data: leads } = useLeads();
  const { data: renewals } = useQuery({
    queryKey: ['notifications', 'renewals', agency?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('renewal_pipeline')
        .select('policy_id, client_name, policy_number, expiry_date')
        .eq('agency_id', agency?.id)
        .in('stage', ['to_contact', 'contacted', 'quoted'])
        .gte('days_to_expiry', -14)
        .lte('days_to_expiry', 30)
        .order('expiry_date');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!session && !!agency?.id,
    refetchInterval: 5 * 60_000,
  });

  const today = todayNairobi();
  const items = useMemo(() => buildNotifications(leads ?? [], renewals ?? [], today), [leads, renewals, today]);
  const urgent = items.filter((i) => i.urgency !== 'later').length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={urgent > 0 ? `Notifications, ${urgent} need attention` : 'Notifications'}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" />
          {urgent > 0 && (
            <span className="absolute -end-1.5 -top-1.5 min-w-5 rounded-full bg-overdue px-1 text-center text-[11px] font-semibold leading-5 text-white dark:text-background tabular-nums ring-2 ring-background">
              {urgent > 99 ? '99+' : urgent}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-baseline justify-between border-b px-4 py-3">
          <p className="font-display font-semibold">Follow-ups and renewals</p>
          <span className="text-xs text-muted-foreground">Next 30 days</span>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up. Set a follow-up on a lead and it will show here.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {items.map((n) => {
              const Icon = n.kind === 'follow_up' ? PhoneCall : CalendarClock;
              return (
                <li key={n.id}>
                  <Link href={n.href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
                    <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE[n.urgency])}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      {n.detail && <span className="block truncate text-xs text-muted-foreground">{n.detail}</span>}
                    </span>
                    <span className="shrink-0 text-end">
                      <span className={cn('block rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[n.urgency])}>{WHEN[n.urgency]}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">{formatDate(n.date)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
