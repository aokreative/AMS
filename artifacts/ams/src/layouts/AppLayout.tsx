import React from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  FileText,
  DollarSign,
  RefreshCcw,
  Building2,
  Tag,
  Settings,
  LogOut,
  Menu,
  BarChart2,
  Receipt,
  Wallet,
  Coins,
  Magnet,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAgentRates, useHasOwnEarnings } from '@/hooks/payouts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandMark } from '@/components/BrandLockup';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { DemoBanner } from '@/components/DemoBanner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { readSidebar, writeSidebar } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

/** Terms and Privacy links at the foot of the menu. */
function LegalLinks() {
  const { t } = useTranslation();
  return (
    <p className="mt-2 px-1 text-[11px] text-muted-foreground">
      <Link href="/terms" className="hover:underline">{t('auth.termsLink')}</Link>
      <span className="mx-1.5">·</span>
      <Link href="/privacy" className="hover:underline">{t('auth.privacyLink')}</Link>
    </p>
  );
}

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  /** An amber count means something is due; grey is just a tally. */
  attention?: boolean;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { agency, profile, signOut, session, isOwnerOrManager } = useAuth();
  const [location] = useLocation();
  const { t } = useTranslation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => readSidebar() === 'collapsed');

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeSidebar(c ? 'expanded' : 'collapsed');
      return !c;
    });
  };

  // Open renewals expiring in the next 30 days
  const { data: renewalsCount = 0 } = useQuery({
    queryKey: ['renewals-count', agency?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('renewal_pipeline')
        .select('policy_id', { count: 'exact', head: true })
        .eq('agency_id', agency?.id)
        .in('stage', ['to_contact', 'contacted', 'quoted'])
        .gte('days_to_expiry', 0)
        .lte('days_to_expiry', 30);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!agency?.id && !!session,
  });

  // Open leads whose follow-up is due today or overdue
  const { data: followUpsDue = 0 } = useQuery({
    queryKey: ['leads', agency?.id, 'due-count'],
    queryFn: async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
      const { count, error } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('stage', ['new', 'contacted', 'quoted', 'won'])
        .lte('next_follow_up', today);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!agency?.id && !!session,
  });

  // Owner/Manager only see "My earnings" when they have a rate of their own or any earnings
  const { data: myRates } = useAgentRates(session?.id);
  const { data: hasOwnEarnings } = useHasOwnEarnings(isOwnerOrManager ? session?.id : undefined);
  const showMyEarnings = !isOwnerOrManager || (myRates?.length ?? 0) > 0 || !!hasOwnEarnings;

  const groups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { name: t('nav.dashboard'), path: '/dashboard', icon: LayoutDashboard },
        { name: t('nav.leads'), path: '/leads', icon: Magnet, count: followUpsDue || undefined, attention: true },
        { name: t('nav.clients'), path: '/clients', icon: Users },
        { name: t('nav.policies'), path: '/policies', icon: FileText },
        { name: t('nav.renewals'), path: '/renewals', icon: RefreshCcw, count: renewalsCount || undefined, attention: true },
      ],
    },
    {
      label: 'Money',
      items: [
        { name: t('nav.commissions'), path: '/commissions', icon: DollarSign },
        ...(isOwnerOrManager ? [{ name: t('nav.receipts'), path: '/receipts', icon: Receipt }] : []),
        ...(isOwnerOrManager ? [{ name: t('nav.payouts'), path: '/payouts', icon: Wallet }] : []),
        ...(showMyEarnings ? [{ name: t('nav.myEarnings'), path: '/my-earnings', icon: Coins }] : []),
      ],
    },
    {
      label: 'Agency',
      items: [
        ...(isOwnerOrManager
          ? [
              { name: t('nav.reports'), path: '/reports', icon: BarChart2 },
              { name: t('nav.insurers'), path: '/insurers', icon: Building2 },
              { name: t('nav.productLines'), path: '/product-lines', icon: Tag },
            ]
          : []),
        { name: t('nav.settings'), path: '/settings', icon: Settings },
      ],
    },
  ];

  const allItems = groups.flatMap((g) => g.items);
  const current = allItems.find((i) => location === i.path || location.startsWith(i.path + '/'));
  const pageTitle = current?.name ?? (location.startsWith('/billing') ? 'Billing' : agency?.name ?? '');
  const initials = profile?.full_name?.substring(0, 2).toUpperCase() || 'U';

  const renderLink = (item: NavItem, rail: boolean) => {
    const isActive = location === item.path || location.startsWith(item.path + '/');
    const Icon = item.icon;
    const link = (
      <Link
        key={item.path}
        href={item.path}
        onClick={() => setIsMobileMenuOpen(false)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={rail ? `${item.name}${item.count ? `, ${item.count}` : ''}` : undefined}
        className={cn(
          'relative flex items-center gap-3 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          rail ? 'mx-auto h-10 w-10 justify-center' : 'px-3 py-2',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        {!rail && <span className="truncate">{item.name}</span>}
        {item.count !== undefined &&
          (rail ? (
            <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-due ring-2 ring-sidebar" aria-hidden />
          ) : (
            <span
              className={cn(
                'ms-auto min-w-6 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums',
                item.attention ? 'bg-due/15 text-due' : 'bg-muted text-muted-foreground',
              )}
            >
              {item.count}
            </span>
          ))}
      </Link>
    );
    return rail ? (
      <Tooltip key={item.path} delayDuration={150}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">
          {item.name}
          {item.count ? ` (${item.count})` : ''}
        </TooltipContent>
      </Tooltip>
    ) : (
      link
    );
  };

  const renderNav = (rail: boolean) => (
    <nav aria-label="Main" className="space-y-5">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label}>
            {rail ? (
              <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-xs font-medium text-muted-foreground">{g.label}</p>
            )}
            <div className="space-y-0.5">{g.items.map((i) => renderLink(i, rail))}</div>
          </div>
        ))}
    </nav>
  );

  const renderUser = (rail: boolean) =>
    rail ? (
      <div className="flex flex-col items-center gap-2 border-t border-sidebar-border py-3">
        <Avatar className="h-9 w-9" title={profile?.full_name ?? undefined}>
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
        </Avatar>
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={signOut}
              aria-label={t('common.signOut')}
              className="rounded-lg border p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('common.signOut')}</TooltipContent>
        </Tooltip>
      </div>
    ) : (
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-xl p-1">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{profile?.full_name}</span>
            <span className="truncate text-xs font-medium text-due">{profile?.role ? t(`roles.${profile.role}`) : ''}</span>
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label={t('common.signOut')}
            title={t('common.signOut')}
            className="rounded-lg border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
        <LegalLinks />
      </div>
    );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar: full or icon rail */}
      <aside
        className={cn(
          'fixed inset-y-0 z-20 hidden shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex print:hidden',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        <div className={cn('flex h-16 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between gap-2 px-4')}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark alt="AMS" className="h-8 w-8 shrink-0" />
            {!collapsed && <span className="truncate font-display text-base font-semibold">{agency?.name || 'AMS'}</span>}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse the menu"
              title="Collapse the menu"
              aria-expanded
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelLeftClose className="h-4 w-4 rtl:rotate-180" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand the menu"
            title="Expand the menu"
            aria-expanded={false}
            className="mx-auto mb-2 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelLeftOpen className="h-4 w-4 rtl:rotate-180" />
          </button>
        )}

        <div className={cn('flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-1', collapsed ? 'px-2' : 'px-3')}>{renderNav(collapsed)}</div>

        {renderUser(collapsed)}
      </aside>

      {/* Main column */}
      <div
        className={cn(
          'flex w-full min-w-0 flex-1 flex-col transition-[padding] duration-200 print:ps-0',
          collapsed ? 'md:ps-[72px]' : 'md:ps-64',
        )}
      >
        {/* Top bar: page title, notifications, appearance */}
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur md:px-8 print:hidden">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-ms-2 md:hidden" aria-label={t('common.menu')}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col border-e-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
              <SheetTitle className="sr-only">{t('common.menu')}</SheetTitle>
              <div className="flex h-16 shrink-0 items-center gap-2 px-4">
                <BrandMark alt="AMS" className="h-8 w-8 shrink-0" />
                <span className="truncate font-display font-semibold">{agency?.name || 'AMS'}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-4">{renderNav(false)}</div>
              {renderUser(false)}
            </SheetContent>
          </Sheet>
          <h1 className="min-w-0 flex-1 truncate font-display text-lg font-semibold md:text-xl">{pageTitle}</h1>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 print:overflow-visible">
          <DemoBanner />
          <SubscriptionBanner />
          <div className="mx-auto w-full max-w-7xl p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
