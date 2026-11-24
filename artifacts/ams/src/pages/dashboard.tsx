import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'wouter';
import { CalendarClock, AlertCircle, BellRing, Magnet, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { useLeadPipeline, useLeads } from '@/hooks/leads';
import { followUpState, pipelineSummary, stageLabel as stageLabelLead } from '@/lib/leads';
import { todayNairobi } from '@/lib/subscription';
import { startOfMonth, endOfMonth, startOfDay, format } from 'date-fns';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { projectedMonthlyCommission } from '@/lib/projection';
import { stageLabel } from '@/lib/renewals';
import type { RenewalStage } from '@/lib/types';

export default function Dashboard() {
  const { agency, session, profile, isOwnerOrManager } = useAuth();
  const isAgent = !!profile && !isOwnerOrManager;
  const my = (label: string, agentLabel: string) => (isAgent ? agentLabel : label);
  const today = todayNairobi();
  const { data: leads } = useLeads();
  const dueLeads = (leads ?? [])
    .filter((l) => ['due', 'overdue'].includes(followUpState(l, today)))
    .sort((a, b) => (a.next_follow_up ?? '').localeCompare(b.next_follow_up ?? ''));
  const newLeads = (leads ?? []).filter((l) => l.stage === 'new').length;
  
  // Dashboard Metrics Queries
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['dashboard-metrics', agency?.id],
    queryFn: async () => {
      if (!agency?.id) throw new Error('No agency');
      
      const today = startOfDay(new Date()).toISOString();
      const startOfCurrentMonth = startOfMonth(new Date()).toISOString();
      const endOfCurrentMonth = endOfMonth(new Date()).toISOString();
      
      // 1. Active policies count
      const { count: activeCount } = await supabase
        .from('policies')
        .select('*', { count: 'exact', head: true })
        .eq('agency_id', agency.id)
        .eq('status', 'active');
        
      // 2. Total premium (active)
      const { data: premiumData } = await supabase
        .from('policies')
        .select('premium_amount')
        .eq('agency_id', agency.id)
        .eq('status', 'active');
        
      const totalPremium = premiumData?.reduce((sum, p) => sum + (p.premium_amount || 0), 0) || 0;
      
      // 3. Open renewals expiring in the next 30 days (renewed/lost ones are done)
      const { count: expiringCount } = await supabase
        .from('renewal_pipeline')
        .select('policy_id', { count: 'exact', head: true })
        .eq('agency_id', agency.id)
        .in('stage', ['to_contact', 'contacted', 'quoted'])
        .gte('days_to_expiry', 0)
        .lte('days_to_expiry', 30);
        
      // 4. Commissions this month (expected & received)
      const { data: commissionsThisMonth } = await supabase
        .from('commission_transactions')
        .select('amount, amount_received, status')
        .eq('agency_id', agency.id)
        .gte('expected_date', startOfCurrentMonth)
        .lte('expected_date', endOfCurrentMonth);
        
      const expectedThisMonth = commissionsThisMonth?.reduce((sum, c) => sum + (c.amount || 0), 0) || 0;
      // Money actually received this month. Owner/Manager: allocations of receipts dated this month.
      // Agents cannot read receipts: fall back to amount_received on this month's commissions.
      let receivedThisMonth = 0;
      if (isOwnerOrManager) {
        const { data: allocs } = await supabase
          .from('commission_allocations')
          .select('amount, receipt:insurer_receipts!inner(received_on)')
          .eq('agency_id', agency.id)
          .gte('receipt.received_on', format(startOfMonth(new Date()), 'yyyy-MM-dd'))
          .lte('receipt.received_on', format(endOfMonth(new Date()), 'yyyy-MM-dd'));
        receivedThisMonth = (allocs ?? []).reduce((sum, a: any) => sum + (Number(a.amount) || 0), 0);
      } else {
        receivedThisMonth = (commissionsThisMonth ?? [])
          .filter(c => c.status === 'received' || c.status === 'part_paid')
          .reduce((sum, c) => sum + (Number(c.amount_received) || 0), 0);
      }
      
      // 5. Overdue commissions
      const { count: overdueCount } = await supabase
        .from('commission_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('agency_id', agency.id)
        .in('status', ['pending', 'part_paid'])
        .lt('expected_date', today.split('T')[0]);

      // 6. Recent policies
      const { data: recentPolicies } = await supabase
        .from('policies')
        .select(`
          id, policy_number, premium_amount, status, created_at,
          client:clients(name), 
          insurer:insurers(name), 
          product_line:product_lines(name)
        `)
        .eq('agency_id', agency.id)
        .order('created_at', { ascending: false })
        .limit(5);
        
      // 7. Upcoming renewals (next 30 days list)
      const { data: upcomingRows } = await supabase
        .from('renewal_pipeline')
        .select('policy_id, policy_number, expiry_date, client_name, insurer_name, stage, days_to_expiry')
        .eq('agency_id', agency.id)
        .in('stage', ['to_contact', 'contacted', 'quoted'])
        .gte('days_to_expiry', 0)
        .lte('days_to_expiry', 30)
        .order('expiry_date', { ascending: true })
        .limit(5);
      const upcomingRenewals = (upcomingRows ?? []).map((r: any) => ({
        id: r.policy_id,
        policy_number: r.policy_number,
        expiry_date: r.expiry_date,
        stage: r.stage as RenewalStage,
        daysLeft: r.days_to_expiry as number,
        client: { name: r.client_name },
        insurer: { name: r.insurer_name },
      }));

      // 7b. Active per-premium (life) policies for the monthly projection
      const { data: perPremiumPolicies } = await supabase
        .from('policies')
        .select('instalment_premium, premium_frequency, commission_rate, renewal_commission_rate, start_date')
        .eq('agency_id', agency.id)
        .eq('status', 'active')
        .eq('commission_basis', 'per_premium');

      // 8. Onboarding counts
      const [{ count: insurerCount }, { count: clientCount }] = await Promise.all([
        supabase.from('insurers').select('*', { count: 'exact', head: true }).eq('agency_id', agency.id),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('agency_id', agency.id),
      ]);

      return {
        activeCount: activeCount || 0,
        totalPremium,
        expiringCount: expiringCount || 0,
        expectedThisMonth,
        receivedThisMonth,
        overdueCount: overdueCount || 0,
        perPremiumCount: perPremiumPolicies?.length || 0,
        projectedMonthly: projectedMonthlyCommission((perPremiumPolicies ?? []) as any),
        recentPolicies: recentPolicies || [],
        upcomingRenewals: upcomingRenewals || [],
        // onboarding
        hasInsurers: (insurerCount || 0) > 0,
        hasClients: (clientCount || 0) > 0,
        hasPolicies: (activeCount || 0) > 0,
      };
    },
    enabled: !!session && !!agency?.id,
  });

  const firstName = profile?.full_name?.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const renewalsThisWeek = (metrics?.upcomingRenewals ?? []).filter((r: any) => r.daysLeft <= 7).length;
  const collectedPct = metrics && metrics.expectedThisMonth > 0
    ? Math.min(100, Math.round((metrics.receivedThisMonth / metrics.expectedThisMonth) * 100))
    : 0;

  const todayItems = [
    { key: 'follow', count: dueLeads.length, label: dueLeads.length === 1 ? 'lead to follow up' : 'leads to follow up', href: '/leads', tone: 'due' as const, icon: BellRing },
    { key: 'new', count: newLeads, label: newLeads === 1 ? 'new lead not yet contacted' : 'new leads not yet contacted', href: '/leads', tone: 'brand' as const, icon: Magnet },
    { key: 'renew', count: renewalsThisWeek, label: renewalsThisWeek === 1 ? 'renewal expiring this week' : 'renewals expiring this week', href: '/renewals', tone: 'due' as const, icon: CalendarClock },
    { key: 'overdue', count: metrics?.overdueCount ?? 0, label: (metrics?.overdueCount ?? 0) === 1 ? 'commission overdue from insurers' : 'commissions overdue from insurers', href: '/commissions', tone: 'overdue' as const, icon: AlertCircle },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {greeting}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {isAgent ? 'Your leads, renewals and commission at a glance.' : `${agency?.name ?? 'Your agency'} on ${format(new Date(), 'EEEE d MMMM')}.`}
          </p>
        </div>
      </header>

      {/* Onboarding checklist — only shown when agency is fresh */}
      {!isLoading && agency?.id && (!metrics?.hasInsurers || !metrics?.hasClients || !metrics?.hasPolicies) && (
        <OnboardingChecklist
          agencyId={agency.id}
          hasInsurers={metrics?.hasInsurers ?? false}
          hasClients={metrics?.hasClients ?? false}
          hasPolicies={metrics?.hasPolicies ?? false}
        />
      )}

      <PipelineRibbon />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Today */}
        <section className="rounded-2xl border bg-card p-5 shadow-panel lg:col-span-3" aria-labelledby="today-h">
          <h2 id="today-h" className="text-xl font-semibold">Today</h2>
          {isLoading ? (
            <div className="mt-4 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : todayItems.length === 0 ? (
            <p className="mt-3 text-muted-foreground">Nothing waiting on you. A good moment to add a lead or call a client.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {todayItems.map((i) => {
                const Icon = i.icon;
                return (
                  <li key={i.key}>
                    <Link
                      href={i.href}
                      className="group flex items-center gap-4 rounded-xl border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                          i.tone === 'due' && 'bg-due/15 text-due',
                          i.tone === 'overdue' && 'bg-overdue/15 text-overdue',
                          i.tone === 'brand' && 'bg-primary/10 text-primary',
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="flex-1">
                        <span className="font-display text-2xl font-semibold tabular-nums">{i.count}</span>{' '}
                        <span className="text-muted-foreground">{i.label}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {dueLeads.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Follow up</h3>
              <ul className="mt-2 divide-y">
                {dueLeads.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{l.interest ?? stageLabelLead(l.stage)}</span>
                    </span>
                    <span className={cn('shrink-0 text-xs font-medium', followUpState(l, today) === 'overdue' ? 'text-overdue' : 'text-due')}>
                      {followUpState(l, today) === 'overdue' ? `since ${formatDate(l.next_follow_up)}` : 'today'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* This month */}
        <section className="rounded-2xl border bg-card p-5 shadow-panel lg:col-span-2" aria-labelledby="month-h">
          <h2 id="month-h" className="text-xl font-semibold">{format(new Date(), 'MMMM')}</h2>
          <dl className="mt-4 space-y-5">
            <div>
              <dt className="text-sm text-muted-foreground">{my('Commission collected', 'My commission collected')}</dt>
              <dd className="mt-1">
                <span className="font-display text-3xl font-semibold tabular-nums">{isLoading ? '—' : formatCurrency(metrics?.receivedThisMonth)}</span>
                <span className="ms-2 text-sm text-muted-foreground">of {formatCurrency(metrics?.expectedThisMonth)} expected</span>
              </dd>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={collectedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Commission collected this month">
                <div className="h-full rounded-full bg-money transition-[width] duration-700" style={{ width: `${collectedPct}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-muted-foreground">{my('Active policies', 'My active policies')}</dt>
                <dd className="font-display text-2xl font-semibold tabular-nums">{isLoading ? '—' : metrics?.activeCount}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{my('Premium in force', 'My premium in force')}</dt>
                <dd className="font-display text-2xl font-semibold tabular-nums">{isLoading ? '—' : formatCurrency(metrics?.totalPremium)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Renewals in 30 days</dt>
                <dd className="font-display text-2xl font-semibold tabular-nums">{isLoading ? '—' : metrics?.expiringCount}</dd>
              </div>
              {(metrics?.perPremiumCount ?? 0) > 0 && (
                <div>
                  <dt className="text-sm text-muted-foreground">Projected monthly (life)</dt>
                  <dd className="font-display text-2xl font-semibold tabular-nums">{formatCurrency(metrics?.projectedMonthly)}</dd>
                </div>
              )}
            </div>
          </dl>
        </section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-panel">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{my('Upcoming renewals', 'My upcoming renewals')}</h2>
            <Link href="/renewals" className="text-sm text-primary hover:underline">All renewals</Link>
          </div>
          {isLoading ? (
            <div className="mt-3 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : metrics?.upcomingRenewals.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No renewals in the next 30 days.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {metrics?.upcomingRenewals.map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.client?.name ?? '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.policy_number} · {r.insurer?.name} · {stageLabel(r.stage)}</span>
                  </span>
                  <span className={cn('shrink-0 text-end text-xs tabular-nums', r.daysLeft <= 7 ? 'font-semibold text-overdue' : 'text-muted-foreground')}>
                    {r.daysLeft === 0 ? 'today' : `${r.daysLeft} days`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-panel">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{my('Recent policies', 'My recent policies')}</h2>
            <Link href="/policies" className="text-sm text-primary hover:underline">All policies</Link>
          </div>
          {isLoading ? (
            <div className="mt-3 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : metrics?.recentPolicies.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No policies yet.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {metrics?.recentPolicies.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.client?.name ?? '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.product_line?.name} · {p.insurer?.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatCurrency(p.premium_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** The pipeline ribbon: one bar split by how many leads sit at each stage. */
function PipelineRibbon() {
  const { data: rows, isLoading } = useLeadPipeline();
  const [, setLocation] = useLocation();
  const s = pipelineSummary(rows ?? []);
  const total = s.stages.reduce((n, x) => n + x.count, 0);
  const SHADES: Record<string, string> = {
    new: 'bg-primary/25',
    contacted: 'bg-primary/45',
    quoted: 'bg-primary/70',
    won: 'bg-primary',
    paid: 'bg-money',
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-panel" aria-labelledby="pipe-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pipe-h" className="text-xl font-semibold">Leads pipeline</h2>
        <p className="text-sm text-muted-foreground">
          {isLoading ? '…' : (
            <>
              <span className="font-display text-lg font-semibold text-foreground tabular-nums">{formatCurrency(s.openQuoted)}</span> being quoted across {s.openCount} open {s.openCount === 1 ? 'lead' : 'leads'}
            </>
          )}
        </p>
      </div>

      {total === 0 && !isLoading ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 p-4">
          <p className="text-sm text-muted-foreground">No leads yet. Add people asking about cover and follow them through to a paid policy.</p>
          <Link href="/leads" className="text-sm font-medium text-primary hover:underline">Add a lead</Link>
        </div>
      ) : (
        <>
          <div className="mt-4 flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {s.stages.filter((x) => x.count > 0).map((x) => (
              <div key={x.stage} className={cn('h-full transition-[flex-grow] duration-700', SHADES[x.stage])} style={{ flexGrow: x.count }} />
            ))}
          </div>
          <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {s.stages.map((x) => (
              <li key={x.stage}>
                <button
                  type="button"
                  onClick={() => setLocation('/leads')}
                  className="w-full rounded-xl p-2 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn('h-2 w-2 rounded-full', SHADES[x.stage])} aria-hidden />
                    {stageLabelLead(x.stage)}
                  </span>
                  <span className="block font-display text-2xl font-semibold tabular-nums">{x.count}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setLocation('/leads')}
                className="w-full rounded-xl p-2 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-overdue/60" aria-hidden />Lost
                </span>
                <span className="block font-display text-2xl font-semibold tabular-nums text-muted-foreground">{s.lost}</span>
              </button>
            </li>
          </ol>
        </>
      )}
    </section>
  );
}
