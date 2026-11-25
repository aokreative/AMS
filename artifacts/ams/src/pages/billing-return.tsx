import { useEffect } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useVerifyPayment } from '@/hooks/subscription';
import { tierName } from '@/lib/subscription';
import { formatDate } from '@/lib/utils';

/** Paystack sends the Owner back here with ?reference= (and ?trxref=). */
export default function BillingReturn() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  const verify = useVerifyPayment();
  const { t } = useTranslation();

  useEffect(() => {
    if (reference) verify.mutate(reference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  const d = verify.data;
  let icon = <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />;
  let title = t('billing.checking');
  let body: React.ReactNode = t('billing.takesSeconds');
  if (!reference) {
    icon = <XCircle className="h-8 w-8 text-destructive" />;
    title = t('billing.noPayment');
    body = t('billing.openBilling');
  } else if (verify.isError) {
    icon = <XCircle className="h-8 w-8 text-destructive" />;
    title = t('billing.couldNotCheck');
    body = (verify.error as Error).message;
  } else if (d?.status === 'paid') {
    icon = <CheckCircle2 className="h-8 w-8 text-emerald-600" />;
    title = t('billing.received');
    body = d.paid_until ? t('billing.receivedBody', { plan: tierName(d.tier), date: formatDate(d.paid_until) }) : t('billing.upgraded');
  } else if (d?.status === 'needs_review') {
    icon = <Clock className="h-8 w-8 text-amber-600" />;
    title = t('billing.held');
    body = t('billing.heldBody');
  } else if (d?.status === 'failed') {
    icon = <XCircle className="h-8 w-8 text-destructive" />;
    title = t('billing.failedTitle');
    body = t('billing.failedBody');
  } else if (d) {
    icon = <Clock className="h-8 w-8 text-amber-600" />;
    title = t('billing.notSeen');
    body = t('billing.notSeenBody');
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardHeader className="items-center text-center">
          {icon}
          <CardTitle className="mt-2">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
          {reference && <p className="mt-2 text-xs text-muted-foreground">{t('billing.reference', { ref: reference })}</p>}
        </CardHeader>
        <CardContent />
        <CardFooter className="flex flex-col gap-2">
          {d?.status === 'pending' && (
            <Button className="w-full" onClick={() => verify.mutate(reference)} disabled={verify.isPending}>
              {verify.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t('billing.checkAgain')}
            </Button>
          )}
          <Button asChild variant={d?.status === 'paid' ? 'default' : 'outline'} className="w-full">
            <Link href={d?.status === 'paid' ? '/dashboard' : '/settings/billing'}>{d?.status === 'paid' ? t('billing.goDashboard') : t('billing.backBilling')}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
