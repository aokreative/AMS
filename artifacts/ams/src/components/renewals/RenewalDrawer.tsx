import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { usePolicyForRenewal, useRenewalActivities } from '@/hooks/renewals';
import { channelLabel, lostReasonLabel, stageLabel } from '@/lib/renewals';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { RenewalActivity, RenewalRow } from '@/lib/types';

function describe(a: RenewalActivity, t: TFunction): string {
  const insurer = a.insurer?.name;
  switch (a.kind) {
    case 'contact':
      return t('policies.contactedBy', { channel: a.channel ? channelLabel(a.channel) : t('policies.unknownChannel') });
    case 'quote':
      return insurer
        ? t('policies.quotedPremiumWith', { premium: formatCurrency(a.premium), insurer })
        : t('policies.quotedPremium', { premium: formatCurrency(a.premium) });
    case 'renewed':
      if (a.premium != null) {
        return insurer
          ? t('policies.renewedAtWith', { premium: formatCurrency(a.premium), insurer })
          : t('policies.renewedAt', { premium: formatCurrency(a.premium) });
      }
      return insurer ? t('policies.renewedWith', { insurer }) : t('policies.renewedPlain');
    case 'lost':
      return t('policies.lostWithReason', { reason: a.lost_reason ? lostReasonLabel(a.lost_reason) : t('policies.noReason') });
    case 'reopened':
      return t('policies.reopenedEvent');
    case 'reset':
      return t('policies.resetEvent');
  }
}

export function RenewalDrawer({ row, onClose }: { row: RenewalRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: activities, isLoading } = useRenewalActivities(row?.renewal_id);
  const { data: newPolicy } = usePolicyForRenewal(row?.renewed_policy_id);

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{row?.client_name ?? t('policies.clientFallback')}</SheetTitle>
          <SheetDescription>
            {row?.policy_number} · {row?.product_line_name} · {row?.insurer_name}
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="mt-6 space-y-6 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground">{t('policies.drawerStage')}</div>
                <Badge variant="secondary">{stageLabel(row.stage)}</Badge>
              </div>
              <div>
                <div className="text-muted-foreground">{t('policies.drawerExpiry')}</div>
                <div>{formatDate(row.expiry_date)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('policies.drawerPremium')}</div>
                <div>{formatCurrency(row.premium_amount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('policies.drawerAgent')}</div>
                <div>{row.agent_name ?? '—'}</div>
              </div>
              {row.quoted_premium != null && (
                <div className="col-span-2">
                  <div className="text-muted-foreground">{t('policies.latestQuote')}</div>
                  <div>
                    {formatCurrency(row.quoted_premium)}
                    {row.quoted_insurer_name ? ` · ${row.quoted_insurer_name}` : ''}
                  </div>
                </div>
              )}
              {row.renewed_policy_id && (
                <div className="col-span-2">
                  <div className="text-muted-foreground">{t('policies.renewedAsLabel')}</div>
                  <div>
                    {newPolicy
                      ? `${newPolicy.policy_number} · ${formatDate(newPolicy.start_date)} – ${formatDate(newPolicy.expiry_date)}`
                      : t('policies.newPolicy')}
                  </div>
                </div>
              )}
            </div>
            <Link href={`/clients/${row.client_id}`} className="text-primary underline-offset-4 hover:underline">
              {t('policies.openClient')}
            </Link>
            <div>
              <h3 className="mb-3 font-semibold">{t('policies.history')}</h3>
              {!row.renewal_id ? (
                <p className="text-muted-foreground">{t('policies.nothingLogged')}</p>
              ) : isLoading ? (
                <p className="text-muted-foreground">{t('common.loading')}</p>
              ) : (
                <ol className="space-y-3">
                  {(activities ?? []).map((a) => (
                    <li key={a.id} className="border-s-2 ps-3">
                      <div className="font-medium">{describe(a, t)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(a.occurred_on)}
                        {a.author?.full_name ? ` · ${a.author.full_name}` : ''}
                      </div>
                      {a.note && <p className="mt-1 whitespace-pre-wrap">{a.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
