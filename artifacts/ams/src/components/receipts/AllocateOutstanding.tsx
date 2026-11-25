import { useTranslation } from 'react-i18next';
import { getCurrency } from '@/lib/money';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import { toCents } from '@/lib/reconcile';
import { formatKes } from '@/lib/receipt-grid';
import type { ReceivableCommission } from '@/hooks/receipts';

export type AllocationState = Record<string, { checked: boolean; amount: string }>;

/** Cents to allocate for one commission, capped at what is remaining. */
export function allocationCents(c: ReceivableCommission, s: AllocationState[string] | undefined): number {
  if (!s?.checked) return 0;
  const cents = toCents(s.amount);
  if (cents === null || cents <= 0) return 0;
  return Math.min(cents, c.remainingCents);
}

export function AllocateOutstanding({
  commissions,
  state,
  onChange,
}: {
  commissions: ReceivableCommission[];
  state: AllocationState;
  onChange: (s: AllocationState) => void;
}) {
  const { t } = useTranslation();
  if (commissions.length === 0) {
    return <div className="text-sm text-muted-foreground border rounded-md p-4">{t('money.allocate.none')}</div>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t('money.allocate.intro')}
      </p>
      <div className="border rounded-md bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>{t('money.shared.policy')}</TableHead>
              <TableHead>{t('money.shared.expected')}</TableHead>
              <TableHead className="text-end">{t('money.shared.remaining')}</TableHead>
              <TableHead className="w-36">{t('money.allocate.applyCur', { currency: getCurrency() })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commissions.map((c) => {
              const s = state[c.id] ?? { checked: false, amount: String(c.remainingCents / 100) };
              const over = (toCents(s.amount) ?? 0) > c.remainingCents;
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Checkbox
                      checked={s.checked}
                      aria-label={t('money.allocate.ariaApply', { policy: c.policyNumber })}
                      onCheckedChange={(v) => onChange({ ...state, [c.id]: { ...s, checked: v === true } })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{c.policyNumber}</div>
                    <div className="text-xs text-muted-foreground">{c.clientName}</div>
                  </TableCell>
                  <TableCell>{c.expectedDate ? formatDate(c.expectedDate) : '—'}</TableCell>
                  <TableCell className="text-end">{formatKes(c.remainingCents)}</TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={s.amount}
                      onChange={(e) => onChange({ ...state, [c.id]: { ...s, amount: e.target.value } })}
                    />
                    {over && <div className="text-xs text-muted-foreground mt-1">{t('money.allocate.capped', { amount: formatKes(c.remainingCents) })}</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
