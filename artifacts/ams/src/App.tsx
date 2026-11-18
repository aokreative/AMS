import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { useEffect } from 'react';
import { notePage } from '@/lib/last-page';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppLayout } from '@/layouts/AppLayout';
import { needsAgencySetup } from '@/lib/auth';
import { agencyAccess, todayNairobi } from '@/lib/subscription';
import { Paywall } from '@/components/billing/Paywall';
import { SuspendedScreen } from '@/components/SuspendedScreen';
import { adminBelongsOnAdminPage } from '@/lib/admin';
import Admin from '@/pages/admin';
import NotFound from '@/pages/not-found';

import Login from '@/pages/login';
import Register from '@/pages/register';
import Join from '@/pages/join';
import Dashboard from '@/pages/dashboard';
import Clients from '@/pages/clients';
import ClientDetail from '@/pages/client-detail';
import Policies from '@/pages/policies';
import Insurers from '@/pages/insurers';
import ProductLines from '@/pages/product-lines';
import Commissions from '@/pages/commissions';
import Receipts from '@/pages/receipts';
import ReceiptNew from '@/pages/receipt-new';
import ReceiptDetail from '@/pages/receipt-detail';
import Payouts from '@/pages/payouts';
import PayoutDetail from '@/pages/payout-detail';
import MyEarnings from '@/pages/my-earnings';
import Renewals from '@/pages/renewals';
import Reports from '@/pages/reports';
import Settings from '@/pages/settings';
import ForgotPassword from '@/pages/forgot-password';
import ResetPassword from '@/pages/reset-password';
import Legal from '@/pages/legal';
import BillingReturn from '@/pages/billing-return';
import Onboarding from '@/pages/onboarding';
import Demo from '@/pages/demo';

/** /admin: superadmins only; everyone else gets Not found (signed-out visitors go to sign in). */
const AdminRoute = () => {
  const { session, isLoading, profileLoadedFor, isPlatformAdmin, inDemo, leaveDemo } = useAuth();
  // Coming back to /admin from inside the demo leaves it: its changes are thrown away.
  useEffect(() => {
    if (isPlatformAdmin && inDemo) void leaveDemo().catch(() => undefined);
  }, [isPlatformAdmin, inDemo, leaveDemo]);
  if (isLoading || (session && profileLoadedFor !== session.id) || (isPlatformAdmin && inDemo)) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }
  if (!session) return <Redirect to="/login" />;
  if (!isPlatformAdmin) return <NotFound />;
  return <Admin />;
};

// Protected Route Wrapper
const ProtectedRoute = ({ component: Component }: { component: React.ComponentType }) => {
  const { session, profile, agency, isLoading, isDeactivated, signOut, profileLoadedFor, isPlatformAdmin, inDemo } = useAuth();
  
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading workspace...</div>;
  if (!session) return <Redirect to="/login" />;
  // A superadmin belongs on the superadmin page, except inside the demo.
  if (adminBelongsOnAdminPage(isPlatformAdmin, inDemo)) return <Redirect to="/admin" />;
  // Signed in (e.g. just verified the email code) but no agency yet: finish sign-up.
  if (needsAgencySetup(session.id, profileLoadedFor, !!profile)) return <Redirect to="/register" />;
  // A suspended agency sees only the suspended screen, before setup or payment.
  if (agency?.suspended_at) return <SuspendedScreen />;
  // Owners finish the setup wizard (language, currency, plan) first.
  if (profile?.role === 'owner' && !profile.deactivated_at && agency && !agency.setup_completed_at) {
    return <Redirect to="/onboarding" />;
  }
  if (isDeactivated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Your access to this agency has been removed</CardTitle>
            <CardDescription>Ask the agency owner if you think this is a mistake.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => { void signOut(); }}>Sign out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // Pay to access: an unpaid agency sees only the pay screen. The Paystack return page stays
  // reachable so a payment can be confirmed.
  if (agency && agencyAccess(agency, todayNairobi()) === 'locked' && window.location.pathname !== '/billing/return') {
    return <Paywall />;
  }

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
};

function Router() {
  const [location] = useLocation();
  useEffect(() => notePage(location), [location]);
  return (
    <Switch>
      <Route path="~^/$" component={() => <Redirect to="/dashboard" />} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/join" component={Join} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/demo" component={Demo} />
      <Route path="/admin" component={AdminRoute} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/privacy" component={() => <Legal kind="privacy" />} />
      <Route path="/terms" component={() => <Legal kind="terms" />} />
      
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/clients" component={() => <ProtectedRoute component={Clients} />} />
      <Route path="/clients/:id" component={() => <ProtectedRoute component={ClientDetail} />} />
      <Route path="/policies" component={() => <ProtectedRoute component={Policies} />} />
      <Route path="/commissions" component={() => <ProtectedRoute component={Commissions} />} />
      <Route path="/receipts" component={() => <ProtectedRoute component={Receipts} />} />
      <Route path="/receipts/new" component={() => <ProtectedRoute component={ReceiptNew} />} />
      <Route path="/receipts/:id" component={() => <ProtectedRoute component={ReceiptDetail} />} />
      <Route path="/payouts" component={() => <ProtectedRoute component={Payouts} />} />
      <Route path="/payouts/:id" component={() => <ProtectedRoute component={PayoutDetail} />} />
      <Route path="/my-earnings" component={() => <ProtectedRoute component={MyEarnings} />} />
      <Route path="/renewals" component={() => <ProtectedRoute component={Renewals} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} />} />
      <Route path="/insurers" component={() => <ProtectedRoute component={Insurers} />} />
      <Route path="/product-lines" component={() => <ProtectedRoute component={ProductLines} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
      <Route path="/settings/billing" component={() => <ProtectedRoute component={() => <Settings tab="billing" />} />} />
      <Route path="/billing/return" component={() => <ProtectedRoute component={BillingReturn} />} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
