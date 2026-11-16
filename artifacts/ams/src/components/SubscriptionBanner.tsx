import { Link } from 'wouter';
import { AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { agencyAccess, daysLeft, todayNairobi } from '@/lib/subscription';

/** Shown to everyone while the agency is in grace or read-only. Hidden while active or comped. */
export function SubscriptionBanner() {
  const { agency, isOwner } = useAuth();
  if (!agency) return null;
  const today = todayNairobi();
  const access = agencyAccess(agency, today);
  if (access === 'active') return null;

  const graceLeft = 3 + (daysLeft(agency, today) ?? 0) + 1;
  const readOnly = access === 'read_only';
  const action = isOwner ? (
    <Link href="/settings/billing" className="font-semibold underline underline-offset-2">Pay now</Link>
  ) : (
    <span className="font-medium">Ask your agency owner to renew.</span>
  );

  return (
    <div
      role="status"
      className={
        readOnly
          ? 'flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive'
          : 'flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
      }
    >
      {readOnly ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>
        {readOnly
          ? agency.paid_until
            ? "Read-only: the agency's subscription has lapsed. You can view everything, but changes are paused. "
            : 'Read-only until the first payment. '
          : `The subscription has expired. ${graceLeft} day${graceLeft === 1 ? '' : 's'} left before the agency becomes read-only. `}
        {action}
      </span>
    </div>
  );
}
