import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreditCard, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePayments, useSubscriptionUsage } from '@/hooks/subscription';
import { agencyAccess, daysLeft, formatKes, tierName, TIERS, todayNairobi } from '@/lib/subscription';
import { PayDialog } from './PayDialog';

const fmt = (d: string) => format(parseISO(d), 'd MMM yyyy');

function UsageRow({ label, used, max }: { label: string; used: number; max: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{max == null ? `${used} · unlimited` : `${used} of ${max}`}</span>
      </div>
      {max != null && <Progress value={Math.min(100, (used / max) * 100)} />}
    </div>
  );
}

export function BillingTab({ welcome }: { welcome?: boolean }) {
  const { agency } = useAuth();
  const { data: payments } = usePayments();
  const { data: usage } = useSubscriptionUsage();
  const [payOpen, setPayOpen] = useState(false);
  if (!agency) return null;

  const today = todayNairobi();
  const access = agencyAccess(agency, today);
  const left = daysLeft(agency, today);
  const comped = !!agency.complimentary_until && agency.complimentary_until >= today;
  const tier = TIERS.find((t) => t.key === agency.subscription_tier);

  let status: React.ReactNode;
  if (comped) status = <>Complimentary until {fmt(agency.complimentary_until!)}</>;
  else if (access === 'active') status = <>Active until {fmt(agency.paid_until!)}</>;
  else if (access === 'grace') status = <>Expired {fmt(agency.paid_until!)}: {3 + (left ?? 0) + 1} day{3 + (left ?? 0) + 1 === 1 ? '' : 's'} of grace left</>;
  else status = agency.paid_until ? <>Access stopped on {fmt(agency.paid_until)}. Pay to keep working.</> : <>No plan yet. Pick a plan to start.</>;

  return (
    <div className="space-y-6 max-w-3xl">
      {welcome && !agency.paid_until && !comped && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">Welcome! Pick a plan to start</p>
                <p className="text-sm text-muted-foreground">Your agency opens once the first payment goes through. Pay with M-Pesa or card.</p>
              </div>
            </div>
            <Button onClick={() => setPayOpen(true)}>Choose a plan</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> {tierName(agency.subscription_tier)} plan</CardTitle>
            <CardDescription className="mt-1">{status}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={access === 'active' ? 'secondary' : 'destructive'}>
              {comped ? 'Complimentary' : access === 'active' ? 'Active' : access === 'grace' ? 'Grace period' : 'Unpaid'}
            </Badge>
            {!comped && <Button size="sm" onClick={() => setPayOpen(true)}>{access === 'active' ? 'Renew or upgrade' : 'Pay now'}</Button>}
          </div>
        </CardHeader>
        {usage && tier && (
          <CardContent className="space-y-4">
            <UsageRow label="Team members (incl. pending invites)" used={usage.members + usage.pending_invites} max={comped ? null : tier.max_members} />
            <UsageRow label="Active policies" used={usage.active_policies} max={comped ? null : tier.max_active_policies} />
            <p className="text-xs text-muted-foreground">{formatKes(tier.price_kes)} per month. Pay 1, 3, 6 or 12 months at a time; time adds on to your current paid period.</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {payments && payments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Plan</TableHead><TableHead>Months</TableHead>
                  <TableHead className="text-right">Amount</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{format(new Date(p.paid_at ?? p.created_at), 'd MMM yyyy')}</TableCell>
                    <TableCell>{tierName(p.tier)}</TableCell>
                    <TableCell>{p.months === 0 ? 'Upgrade' : p.months}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatKes(p.amount_kes)}</TableCell>
                    <TableCell className="capitalize">{p.channel === 'mobile_money' ? 'M-Pesa' : p.channel ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'paid' ? 'secondary' : p.status === 'failed' ? 'destructive' : 'outline'} className="capitalize">{p.status === 'needs_review' ? 'Held for review' : p.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          )}
        </CardContent>
      </Card>

      <PayDialog open={payOpen} onOpenChange={setPayOpen} />
    </div>
  );
}
