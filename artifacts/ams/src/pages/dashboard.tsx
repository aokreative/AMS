import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'wouter';
import { CalendarClock, AlertCircle, BellRing, Magnet, Wallet, FileText, TrendingUp, Coins } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { useMonthlyPremiumVolume, useTopClients } from '@/hooks/queries';
import { getCurrency } from '@/lib/money';
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

      // 7a. Open renewals expiring within 7 days (full count, not just the 5 listed)
      const { count: renewalsThisWeek } = await supabase
        .from('renewal_pipeline')
        .select('policy_id', { count: 'exact', head: true })
        .eq('agency_id', agency.id)
        .in('stage', ['to_contact', 'contacted', 'quoted'])
        .gte('days_to_expiry', 0)
        .lte('days_to_expiry', 7);

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
        renewalsThisWeek: renewalsThisWeek || 0,
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
  const { data: pipelineRows } = useLeadPipeline();
  const pipe = pipelineSummary(pipelineRows ?? []);
  const collectedPct = metrics && metrics.expectedThisMonth > 0
    ? Math.min(100, Math.round((metrics.receivedThisMonth / metrics.expectedThisMonth) * 100))
    : 0;

  const tiles = [
    { label: 'Follow-ups due', value: dueLeads.length, href: '/leads' },
    { label: 'Renewals this week', value: metrics?.renewalsThisWeek ?? 0, href: '/renewals' },
    { label: 'Open leads', value: pipe.openCount, href: '/leads' },
    { label: 'Overdue commissions', value: metrics?.overdueCount ?? 0, href: '/commissions' },
  ];

  return (
    <div className="space-y-6">
      {/* Onboarding checklist — only shown when agency is fresh */}
      {!isLoading && agency?.id && (!metrics?.hasInsurers || !metrics?.hasClients || !metrics?.hasPolicies) && (
        <OnboardingChecklist
          agencyId={agency.id}
          hasInsurers={metrics?.hasInsurers ?? false}
          hasClients={metrics?.hasClients ?? false}
          hasPolicies={metrics?.hasPolicies ?? false}
        />
      )}

      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl p-6 text-white shadow-panel sm:p-8"
        style={{ background: 'linear-gradient(120deg, var(--hero-from) 0%, var(--hero-via) 48%, var(--hero-to) 100%)' }}
        aria-labelledby="hero-greeting"
      >
        <div className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-white/[0.06]" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-sm text-white/90">{format(new Date(), 'EEEE d MMMM')}</p>
            <h2 id="hero-greeting" className="mt-1 text-2xl font-semibold sm:text-3xl">
              {greeting}{firstName ? `, ${firstName}` : ''}
            </h2>
            <p className="mt-5 text-sm text-white/90">{my('Commission collected this month', 'Your commission collected this month')}</p>
            <p className="font-display text-4xl font-bold tabular-nums sm:text-5xl">{isLoading ? '—' : formatCurrency(metrics?.receivedThisMonth)}</p>
            <div className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={collectedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Commission collected against expected">
              <div className="h-full rounded-full bg-white/85 transition-[width] duration-700" style={{ width: `${collectedPct}%` }} />
            </div>
            <p className="mt-2 text-sm text-white/90">
              {collectedPct}% of {formatCurrency(metrics?.expectedThisMonth)} expected · {formatCurrency(pipe.openQuoted)} being quoted
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((x) => (
              <li key={x.label}>
                <Link
                  href={x.href}
                  className="block min-w-28 rounded-xl border border-white/15 bg-white/[0.08] px-4 py-3 transition-colors hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <span className="block font-display text-2xl font-bold tabular-nums">{isLoading ? '—' : x.value}</span>
                  <span className="block text-xs text-white/90">{x.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Number cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Wallet} tone="money" label={my('Premium in force', 'Your premium in force')} value={isLoading ? '—' : formatCurrency(metrics?.totalPremium)} note={`${metrics?.activeCount ?? 0} active policies`} />
        <StatTile icon={FileText} tone="brand" label={my('Active policies', 'Your active policies')} value={isLoading ? '—' : String(metrics?.activeCount ?? 0)} note={`${metrics?.expiringCount ?? 0} renew in 30 days`} />
        <StatTile icon={TrendingUp} tone="brand" label="Pipeline value" value={formatCurrency(pipe.openQuoted)} note={`${pipe.openCount} open ${pipe.openCount === 1 ? 'lead' : 'leads'}`} href="/leads" />
        <StatTile icon={Coins} tone="due" label={my('Commission expected', 'Your commission expected')} value={isLoading ? '—' : formatCurrency(metrics?.expectedThisMonth)} note="This month" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <PremiumChart />
        <TopClients />
      </div>
    </div>
  );
}

const TILE_TONE = {
  money: 'bg-money/12 text-money',
  brand: 'bg-primary/10 text-primary',
  due: 'bg-due/15 text-due',
} as const;

function StatTile({ icon: Icon, tone, label, value, note, href }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TILE_TONE;
  label: string;
  value: string;
  note: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', TILE_TONE[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="mt-4 font-display text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
    </>
  );
  const cls = 'block rounded-2xl border bg-card p-5 shadow-panel';
  return href ? (
    <Link href={href} className={cn(cls, 'transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function PremiumChart() {
  const { data, isLoading } = useMonthlyPremiumVolume();
  const [series, setSeries] = useState<'premium' | 'expected'>('premium');
  const currency = getCurrency();
  const compact = (n: number) => `${currency} ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-panel lg:col-span-3" aria-labelledby="chart-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="chart-h" className="text-lg font-semibold">{series === 'premium' ? 'Premium written' : 'Commission expected'}</h2>
        <div className="inline-flex rounded-lg border bg-muted p-0.5 text-sm" aria-label="Chart">
          {(['premium', 'expected'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={series === k}
              onClick={() => setSeries(k)}
              className={cn('rounded-md px-3 py-1 font-medium transition-colors', series === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {k === 'premium' ? 'Premium' : 'Commission'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 h-64">
        {isLoading ? (
          <div className="h-full animate-pulse rounded-xl bg-muted" />
        ) : (data?.length ?? 0) === 0 ? (
          <p className="pt-20 text-center text-sm text-muted-foreground">Policies you add will chart here month by month.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} width={72} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickFormatter={compact} />
              <ChartTooltip
                formatter={(v: number) => [formatCurrency(v), series === 'premium' ? 'Premium' : 'Commission']}
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, color: 'hsl(var(--popover-foreground))' }}
              />
              <Area type="monotone" dataKey={series} stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#area-fill)" dot={{ r: 3.5, fill: 'hsl(var(--primary))', strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function TopClients() {
  const { data, isLoading } = useTopClients();
  const max = Math.max(1, ...(data ?? []).map((c) => c.premium));
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-panel lg:col-span-2" aria-labelledby="top-h">
      <div className="flex items-baseline justify-between">
        <h2 id="top-h" className="text-lg font-semibold">Top clients by premium</h2>
        <Link href="/clients" className="text-sm text-primary hover:underline">All clients</Link>
      </div>
      {isLoading ? (
        <div className="mt-4 space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-muted" />)}</div>
      ) : (data?.length ?? 0) === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No policies yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {data!.map((c) => (
            <li key={c.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{c.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency(c.premium)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (c.premium / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
