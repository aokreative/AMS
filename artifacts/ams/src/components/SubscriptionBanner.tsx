import { Link } from 'wouter';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { agencyAccess, daysLeft, GRACE_DAYS, todayNairobi } from '@/lib/subscription';
import { useTranslation } from 'react-i18next';

/** Warning shown to everyone during the 3 days of grace after a missed renewal. (Unpaid agencies see the pay screen instead.) */
export function SubscriptionBanner() {
  const { agency, isOwner } = useAuth();
  const { t } = useTranslation();
  if (!agency) return null;
  const today = todayNairobi();
  if (agencyAccess(agency, today) !== 'grace') return null;

  const graceLeft = GRACE_DAYS + (daysLeft(agency, today) ?? 0) + 1;
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {t('banner.grace', { count: graceLeft })}{' '}
        {isOwner ? (
          <Link href="/settings/billing" className="font-semibold underline underline-offset-2">{t('banner.payNow')}</Link>
        ) : (
          <span className="font-medium">{t('banner.askOwner')}</span>
        )}
      </span>
    </div>
  );
}
