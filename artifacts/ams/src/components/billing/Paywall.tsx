import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Lock, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { exportToCsv } from '@/lib/csv-export';
import { BrandMark } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlanPicker } from './PlanPicker';

type Kind = 'clients' | 'policies';

async function downloadData(kind: Kind, agencyId: string): Promise<number> {
  if (kind === 'clients') {
    const { data, error } = await supabase
      .from('clients')
      .select('name, type, email, phone, kra_pin, id_or_reg_number, address, created_at')
      .eq('agency_id', agencyId)
      .order('name');
    if (error) throw error;
    exportToCsv('clients', (data ?? []) as Record<string, unknown>[]);
    return data?.length ?? 0;
  }
  const { data, error } = await supabase
    .from('policies')
    .select(
      'policy_number, status, premium_amount, commission_rate, commission_expected, start_date, expiry_date, notes, client:clients(name), insurer:insurers(name), product_line:product_lines(name), agent:users(full_name)',
    )
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  exportToCsv('policies', (data ?? []) as unknown as Record<string, unknown>[]);
  return data?.length ?? 0;
}

/**
 * Shown instead of the app while the agency has not paid (no payment yet, or more than 3 days past
 * renewal). Owners can pay here and download their clients and policies; other members are asked to
 * get an Owner to renew. The database still refuses changes while unpaid, as a backstop.
 */
export function Paywall() {
  const { t } = useTranslation();
  const { agency, isOwner, signOut } = useAuth();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const isNew = !agency?.paid_until;

  const download = async (kind: Kind) => {
    if (!agency) return;
    setBusy(kind);
    setNote(null);
    try {
      const n = await downloadData(kind, agency.id);
      if (n === 0) setNote(t('paywall.nothing'));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="h-10 w-10" />
            <span className="truncate font-semibold">{agency?.name}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut className="me-1 h-4 w-4" />
            {t('common.signOut')}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <CardTitle>{isNew ? t('paywall.titleNew') : t('paywall.titleLapsed')}</CardTitle>
            <CardDescription>{isOwner ? t('paywall.bodyOwner') : t('paywall.bodyMember')}</CardDescription>
          </CardHeader>
          {isOwner && (
            <CardContent>
              <PlanPicker />
            </CardContent>
          )}
        </Card>

        {isOwner && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('paywall.download')}</CardTitle>
              <CardDescription>{t('paywall.downloadHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                {(['clients', 'policies'] as const).map((k) => (
                  <Button key={k} variant="outline" onClick={() => void download(k)} disabled={busy !== null}>
                    {busy === k ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
                    {t(`paywall.${k}`)}
                  </Button>
                ))}
              </div>
              {note && <p className="text-sm text-muted-foreground">{note}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
