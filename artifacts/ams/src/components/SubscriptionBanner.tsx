import { Link } from 'wouter';
import { AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { agencyAccess, daysLeft, todayNairobi } from '@/lib/subscription';
import { useTranslation } from 'react-i18next';

/** Shown to everyone while the agency is in grace or read-only. Hidden while active or comped. */
export function SubscriptionBanner() {
  const { agency, isOwner } = useAuth();
  const { t } = useTranslation();
  if (!agency) return null;
  const today = todayNairobi();
  const access = agencyAccess(agency, today);
  if (access === 'active') return null;

  const graceLeft = 3 + (daysLeft(agency, today) ?? 0) + 1;
  const readOnly = access === 'read_only';
  const action = isOwner ? (
    <Link href="/settings/billing" className="font-semibold underline underline-offset-2">{t('banner.payNow')}</Link>
  ) : (
    <span className="font-medium">{t('banner.askOwner')}</span>
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
            ? `${t('banner.readOnlyLapsed')} `
            : `${t('banner.readOnlyNew')} `
          : `${t('banner.grace', { count: graceLeft })} `}
        {action}
      </span>
    </div>
  );
}
