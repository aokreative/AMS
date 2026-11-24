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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandMark } from '@/components/BrandLockup';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { DemoBanner } from '@/components/DemoBanner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { readSidebar, writeSidebar } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

/** Terms and Privacy links at the foot of the menu. */
function LegalLinks() {
  const { t } = useTranslation();
  return (
    <p className="mt-2 px-2 text-xs text-sidebar-foreground/60">
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
  badge?: number;
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

  const navItems: NavItem[] = [
    { name: t('nav.dashboard'), path: '/dashboard', icon: LayoutDashboard },
    { name: t('nav.leads'), path: '/leads', icon: Magnet, badge: followUpsDue > 0 ? followUpsDue : undefined },
    { name: t('nav.clients'), path: '/clients', icon: Users },
    { name: t('nav.policies'), path: '/policies', icon: FileText },
    { name: t('nav.renewals'), path: '/renewals', icon: RefreshCcw, badge: renewalsCount > 0 ? renewalsCount : undefined },
    { name: t('nav.commissions'), path: '/commissions', icon: DollarSign },
    ...(isOwnerOrManager ? [{ name: t('nav.receipts'), path: '/receipts', icon: Receipt }] : []),
    ...(isOwnerOrManager ? [{ name: t('nav.payouts'), path: '/payouts', icon: Wallet }] : []),
    ...(showMyEarnings ? [{ name: t('nav.myEarnings'), path: '/my-earnings', icon: Coins }] : []),
    ...(isOwnerOrManager
      ? [
          { name: t('nav.reports'), path: '/reports', icon: BarChart2 },
          { name: t('nav.insurers'), path: '/insurers', icon: Building2 },
          { name: t('nav.productLines'), path: '/product-lines', icon: Tag },
        ]
      : []),
    { name: t('nav.settings'), path: '/settings', icon: Settings },
  ];

  const initials = profile?.full_name?.substring(0, 2).toUpperCase() || 'U';

  const NavLinks = ({ rail = false }: { rail?: boolean }) => (
    <nav className="space-y-0.5" aria-label="Main">
      {navItems.map((item) => {
        const isActive = location === item.path || location.startsWith(item.path + '/');
        const Icon = item.icon;
        const link = (
          <Link
            key={item.path}
            href={item.path}
            onClick={() => setIsMobileMenuOpen(false)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={rail ? item.name : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              rail ? 'h-10 w-10 justify-center' : 'px-3 py-2',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            {isActive && <span className="absolute inset-y-1.5 -start-3 w-1 rounded-full bg-sidebar-primary" aria-hidden />}
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!rail && <span className="truncate">{item.name}</span>}
            {item.badge !== undefined &&
              (rail ? (
                <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-due ring-2 ring-sidebar" aria-hidden />
              ) : (
                <span className="ms-auto min-w-5 rounded-full bg-due px-1.5 text-center text-[11px] font-semibold leading-5 text-sidebar tabular-nums">
                  {item.badge}
                </span>
              ))}
          </Link>
        );
        return rail ? (
          <Tooltip key={item.path} delayDuration={150}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">
              {item.name}
              {item.badge !== undefined && ` (${item.badge})`}
            </TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );

  const Footer = ({ rail = false }: { rail?: boolean }) => (
    <div className={cn('shrink-0 border-t border-sidebar-border/60', rail ? 'flex flex-col items-center gap-2 py-3' : 'p-4')}>
      {rail ? (
        <>
          <ThemeToggle className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={signOut}
                aria-label={t('common.signOut')}
                className="rounded-lg p-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('common.signOut')}</TooltipContent>
          </Tooltip>
          <Avatar className="h-8 w-8 border border-sidebar-border/60" title={profile?.full_name ?? undefined}>
            <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-foreground">{initials}</AvatarFallback>
          </Avatar>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-sidebar-border/60">
              <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="truncate text-sm font-medium text-sidebar-foreground">{profile?.full_name}</span>
              <span className="truncate text-xs text-sidebar-foreground/60">{profile?.role ? t(`roles.${profile.role}`) : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              className="flex-1 justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={signOut}
            >
              <LogOut className="me-2 h-4 w-4" />
              {t('common.signOut')}
            </Button>
            <ThemeToggle className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          </div>
          <LegalLinks />
        </>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar: full or icon rail */}
      <aside
        className={cn(
          'fixed inset-y-0 z-20 hidden shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex print:hidden',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b border-sidebar-border/60', collapsed ? 'justify-center' : 'gap-2 px-4')}>
          <BrandMark alt="AMS" className="h-7 w-7 shrink-0" />
          {!collapsed && <span className="truncate font-display font-semibold text-sidebar-foreground">{agency?.name || t('nav.workspace')}</span>}
        </div>

        <div className={cn('flex-1 overflow-y-auto overflow-x-hidden py-3', collapsed ? 'flex flex-col items-center px-2' : 'px-3')}>
          <NavLinks rail={collapsed} />
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          className={cn(
            'mx-3 mb-2 flex items-center gap-2 rounded-lg p-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            collapsed && 'mx-auto',
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4 rtl:rotate-180" /> : <PanelLeftClose className="h-4 w-4 rtl:rotate-180" />}
          {!collapsed && <span>Collapse</span>}
        </button>

        <Footer rail={collapsed} />
      </aside>

      {/* Main content */}
      <div
        className={cn(
          'flex w-full min-w-0 flex-1 flex-col overflow-hidden transition-[padding] duration-200 print:overflow-visible print:ps-0',
          collapsed ? 'md:ps-[72px]' : 'md:ps-64',
        )}
      >
        {/* Mobile header */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 md:hidden print:hidden">
          <div className="flex items-center gap-2 truncate font-bold">
            <BrandMark alt="AMS" className="h-7 w-7 shrink-0" />
            <span className="truncate font-display text-sm">{agency?.name || t('nav.workspace')}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="-me-2" aria-label={t('common.menu')}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 border-e-sidebar-border bg-sidebar p-0">
                <div className="flex h-full flex-col">
                  <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border/60 px-4">
                    <span className="font-display font-semibold text-sidebar-foreground">{t('common.menu')}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3">
                    <NavLinks />
                  </div>
                  <Footer />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <main className="flex-1 overflow-auto print:overflow-visible">
          <DemoBanner />
          <SubscriptionBanner />
          <div className="container mx-auto max-w-7xl p-4 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
