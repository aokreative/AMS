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
  Coins
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAgentRates, useHasOwnEarnings } from '@/hooks/payouts';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandMark } from '@/components/BrandLockup';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { DemoBanner } from '@/components/DemoBanner';
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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { agency, profile, signOut, session, isOwnerOrManager } = useAuth();
  const [location] = useLocation();
  const { t } = useTranslation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  // Get count of upcoming renewals in 30 days
  const { data: renewalsCount = 0 } = useQuery({
    queryKey: ['renewals-count', agency?.id],
    queryFn: async () => {
      // Open renewals expiring in the next 30 days (renewed/lost ones are done)
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

  // Owner/Manager only see "My earnings" when they have a rate of their own or any earnings
  const { data: myRates } = useAgentRates(session?.id);
  const { data: hasOwnEarnings } = useHasOwnEarnings(isOwnerOrManager ? session?.id : undefined);
  const showMyEarnings = !isOwnerOrManager || (myRates?.length ?? 0) > 0 || !!hasOwnEarnings;

  const navItems = [
    { name: t('nav.dashboard'), path: '/dashboard', icon: LayoutDashboard },
    { name: t('nav.clients'), path: '/clients', icon: Users },
    { name: t('nav.policies'), path: '/policies', icon: FileText },
    { name: t('nav.commissions'), path: '/commissions', icon: DollarSign },
    ...(isOwnerOrManager ? [{ name: t('nav.receipts'), path: '/receipts', icon: Receipt }] : []),
    ...(isOwnerOrManager ? [{ name: t('nav.payouts'), path: '/payouts', icon: Wallet }] : []),
    ...(showMyEarnings ? [{ name: t('nav.myEarnings'), path: '/my-earnings', icon: Coins }] : []),
    { 
      name: t('nav.renewals'),
      path: '/renewals', 
      icon: RefreshCcw,
      badge: renewalsCount > 0 ? renewalsCount : undefined
    },
    // Owner/manager-only items
    ...(isOwnerOrManager ? [
      { name: t('nav.reports'), path: '/reports', icon: BarChart2 },
      { name: t('nav.insurers'), path: '/insurers', icon: Building2 },
      { name: t('nav.productLines'), path: '/product-lines', icon: Tag },
    ] : []),
    { name: t('nav.settings'), path: '/settings', icon: Settings },
  ];

  const NavLinks = () => (
    <div className="space-y-1">
      {navItems.map((item) => {
        const isActive = location === item.path || location.startsWith(item.path + '/');
        const Icon = item.icon;
        
        return (
          <Link key={item.path} href={item.path} onClick={() => setIsMobileMenuOpen(false)}>
            <div
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium ${
                isActive 
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground' 
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.name}</span>
              {item.badge !== undefined && (
                <Badge variant="destructive" className="ml-auto h-5 px-1.5 text-[10px] min-w-[20px] flex items-center justify-center rounded-full">
                  {item.badge}
                </Badge>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex print:hidden flex-col w-64 bg-sidebar border-r border-sidebar-border shrink-0 fixed inset-y-0 z-20">
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border/50 shrink-0">
          <div className="flex items-center gap-2 font-bold text-sidebar-foreground truncate">
            <BrandMark alt="AMS" className="h-7 w-7 shrink-0" />
            <span className="truncate">{agency?.name || t('nav.workspace')}</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </div>
        
        <div className="p-4 border-t border-sidebar-border/50 shrink-0 mt-auto bg-sidebar/95">
          <div className="flex items-center gap-3 mb-4">
            <Avatar className="h-9 w-9 border border-sidebar-border/50">
              <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs">
                {profile?.full_name?.substring(0, 2).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col flex-1 overflow-hidden">
              <span className="text-sm font-medium text-sidebar-foreground truncate">
                {profile?.full_name}
              </span>
              <span className="text-xs text-sidebar-foreground/60 capitalize truncate">
                {profile?.role ? t(`roles.${profile.role}`) : ''}
              </span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" 
            onClick={signOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t('common.signOut')}
          </Button>
          <LegalLinks />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:pl-64 print:pl-0 w-full overflow-hidden print:overflow-visible">
        {/* Mobile Header */}
        <header className="md:hidden print:hidden h-14 border-b bg-card flex items-center justify-between px-4 shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-2 font-bold truncate">
            <BrandMark alt="AMS" className="h-7 w-7 shrink-0" />
            <span className="truncate text-sm">{agency?.name || t('nav.workspace')}</span>
          </div>
          
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-2">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar border-r-sidebar-border">
              <div className="flex flex-col h-full">
                <div className="h-14 flex items-center px-4 border-b border-sidebar-border/50 shrink-0">
                  <span className="font-bold text-sidebar-foreground">{t('common.menu')}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <NavLinks />
                </div>
                <div className="p-4 border-t border-sidebar-border/50 shrink-0 mt-auto bg-sidebar">
                  <div className="flex items-center gap-3 mb-4">
                    <Avatar className="h-9 w-9 border border-sidebar-border/50">
                      <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs">
                        {profile?.full_name?.substring(0, 2).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <span className="text-sm font-medium text-sidebar-foreground truncate">
                        {profile?.full_name}
                      </span>
                      <span className="text-xs text-sidebar-foreground/60 capitalize truncate">
                        {profile?.role ? t(`roles.${profile.role}`) : ''}
                      </span>
                    </div>
                  </div>
                          <Button 
                    variant="ghost" 
                    className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" 
                    onClick={signOut}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('common.signOut')}
                  </Button>
                  <LegalLinks />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto print:overflow-visible bg-background/50">
          <DemoBanner />
          <SubscriptionBanner />
          <div className="container mx-auto p-4 md:p-6 max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
