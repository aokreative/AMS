import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2 } from 'lucide-react';
import { toCents } from '@/lib/reconcile';
import { getCurrency } from '@/lib/money';
import { emptyRow, parsePastedRows, isMultiCellPaste, rowErrors, rowIsEmpty, formatKes, type GridRow } from '@/lib/receipt-grid';

const FIELDS: (keyof GridRow)[] = ['policyNumber', 'clientName', 'premium', 'commission', 'period'];
const PLACEHOLDER_KEYS = ['money.shared.policyNo', 'money.shared.client', 'money.shared.premium', 'money.shared.commission', 'money.grid.periodPlaceholder'];

export function LinesGrid({
  rows,
  onChange,
  amountCents,
}: {
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  amountCents: number | null;
}) {
  const { t } = useTranslation();
  const focusCell = (r: number, c: number) => {
    setTimeout(() => {
      document.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
    }, 0);
  };

  const setCell = (r: number, field: keyof GridRow, value: string) => {
    onChange(rows.map((row, i) => (i === r ? { ...row, [field]: value } : row)));
  };

  const addRowAfter = (r: number) => {
    const next = [...rows];
    next.splice(r + 1, 0, emptyRow());
    onChange(next);
    focusCell(r + 1, 0);
  };

  const removeRow = (r: number) => {
    const next = rows.filter((_, i) => i !== r);
    onChange(next.length ? next : [emptyRow()]);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number) => {
    const text = e.clipboardData.getData('text');
    if (!isMultiCellPaste(text)) return; // plain single value: let it paste normally
    const parsed = parsePastedRows(text);
    if (parsed.length === 0) return;
    e.preventDefault();
    const next = [...rows];
    const replace = rowIsEmpty(next[r]) ? 1 : 0;
    next.splice(r + (replace ? 0 : 1), replace, ...parsed);
    onChange(next);
  };

  const linesTotal = rows.reduce((s, row) => s + (toCents(row.commission) ?? 0), 0);
  const diff = amountCents === null ? null : linesTotal - amountCents;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('money.grid.intro')}
      </p>
      <div className="border rounded-md bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px]">{t('money.shared.policyNo')}</TableHead>
              <TableHead className="min-w-[160px]">{t('money.shared.client')}</TableHead>
              <TableHead className="min-w-[110px]">{t('money.shared.premium')}</TableHead>
              <TableHead className="min-w-[120px]">{t('money.shared.commission')}</TableHead>
              <TableHead className="min-w-[130px]">{t('money.shared.period')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, r) => {
              const err = rowErrors(row);
              const cents = toCents(row.commission);
              const isReversal = !rowIsEmpty(row) && cents !== null && cents <= 0;
              return (
                <TableRow key={r}>
                  {FIELDS.map((field, c) => (
                    <TableCell key={field} className="p-1 align-top">
                      <Input
                        data-cell={`${r}-${c}`}
                        value={row[field]}
                        placeholder={t(PLACEHOLDER_KEYS[c])}
                        inputMode={field === 'premium' || field === 'commission' ? 'decimal' : undefined}
                        aria-invalid={(field === 'commission' && err.amount) || (field === 'premium' && err.premium) || (field === 'period' && err.date) || undefined}
                        className={
                          (field === 'commission' && err.amount) || (field === 'premium' && err.premium) || (field === 'period' && err.date)
                            ? 'border-destructive'
                            : ''
                        }
                        onChange={(e) => setCell(r, field, e.target.value)}
                        onPaste={(e) => handlePaste(e, r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addRowAfter(r);
                          }
                        }}
                      />
                      {field === 'premium' && err.premium && (
                        <div className="text-xs text-destructive mt-1">{t('money.grid.checkAmount')}</div>
                      )}
                      {field === 'commission' && err.amount && (
                        <div className="text-xs text-destructive mt-1">{t('money.grid.checkAmount')}</div>
                      )}
                      {field === 'commission' && isReversal && (
                        <Badge variant="warning" className="mt-1">{t('money.grid.reversal')}</Badge>
                      )}
                      {field === 'period' && err.date && (
                        <div className="text-xs text-destructive mt-1">{t('money.grid.checkDate')}</div>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="p-1 align-top">
                    <Button type="button" variant="ghost" size="icon" aria-label={t('money.grid.removeRow')} onClick={() => removeRow(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => addRowAfter(rows.length - 1)}>
          {t('money.grid.addRow')}
        </Button>
        <div className="text-sm">
          {t('money.grid.totals', { currency: getCurrency(), lines: formatKes(linesTotal), received: amountCents === null ? '—' : formatKes(amountCents) })}
          {diff !== null && diff !== 0 && (
            <span className={diff > 0 ? 'text-destructive ms-2' : 'text-muted-foreground ms-2'}>
              ({diff > 0 ? '+' : '-'}{getCurrency()} {formatKes(Math.abs(diff))})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

