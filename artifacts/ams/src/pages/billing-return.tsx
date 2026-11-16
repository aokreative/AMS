import { useEffect } from 'react';
import { Link } from 'wouter';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useVerifyPayment } from '@/hooks/subscription';
import { tierName } from '@/lib/subscription';

/** Paystack sends the Owner back here with ?reference= (and ?trxref=). */
export default function BillingReturn() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  const verify = useVerifyPayment();

  useEffect(() => {
    if (reference) verify.mutate(reference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  const d = verify.data;
  let icon = <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />;
  let title = 'Checking your payment…';
  let body: React.ReactNode = 'This takes a few seconds.';
  if (!reference) {
    icon = <XCircle className="h-8 w-8 text-destructive" />;
    title = 'No payment to check';
    body = 'Open Billing to start a payment.';
  } else if (verify.isError) {
    icon = <XCircle className="h-8 w-8 text-destructive" />;
    title = 'Could not check the payment';
    body = (verify.error as Error).message;
  } else if (d?.status === 'paid') {
    icon = <CheckCircle2 className="h-8 w-8 text-emerald-600" />;
    title = 'Payment received';
    body = d.paid_until ? `${tierName(d.tier)} plan, active until ${format(parseISO(d.paid_until), 'd MMM yyyy')}.` : 'Your plan has been upgraded.';
  } else if (d?.status === 'needs_review') {
    icon = <Clock className="h-8 w-8 text-amber-600" />;
    title = 'Payment received, held for review';
    body = 'Your plan changed while this payment was open, so we will apply or refund it by hand. Contact support with the reference below.';
  } else if (d?.status === 'failed') {
    icon = <XCircle className="h-8 w-8 text-destructive" />;
    title = 'Payment not completed';
    body = 'Paystack reported this payment as failed. If money left your account, contact support with the reference below.';
  } else if (d) {
    icon = <Clock className="h-8 w-8 text-amber-600" />;
    title = "We haven't seen the payment yet";
    body = 'If you still need to approve the M-Pesa prompt on your phone, do that now. Confirmations can take a minute.';
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader className="items-center text-center">
          {icon}
          <CardTitle className="mt-2">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
          {reference && <p className="mt-2 text-xs text-muted-foreground">Reference: {reference}</p>}
        </CardHeader>
        <CardContent />
        <CardFooter className="flex flex-col gap-2">
          {d?.status === 'pending' && (
            <Button className="w-full" onClick={() => verify.mutate(reference)} disabled={verify.isPending}>
              {verify.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check again
            </Button>
          )}
          <Button asChild variant={d?.status === 'paid' ? 'default' : 'outline'} className="w-full">
            <Link href={d?.status === 'paid' ? '/dashboard' : '/settings/billing'}>{d?.status === 'paid' ? 'Go to dashboard' : 'Back to Billing'}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
