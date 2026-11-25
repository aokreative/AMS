import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useProductLines } from '@/hooks/queries';
import { useAgentRates, useSetAgentRates } from '@/hooks/payouts';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  member: { id: string; full_name: string } | null;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
}

interface OverrideRow {
  key: number;
  productLineId: string;
  rate: string;
}

export function AgentRatesDialog({ member, canEdit, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: productLines } = useProductLines();
  const { data: rates, isLoading } = useAgentRates(member?.id);
  const setRates = useSetAgentRates();
  const [defaultRate, setDefaultRate] = useState('');
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [nextKey, setNextKey] = useState(1);

  // Seed the form once per member (first load), not on every refetch,
  // so a background refetch never wipes what the owner is typing.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!member) { seededFor.current = null; return; }
    if (!rates || seededFor.current === member.id) return;
    seededFor.current = member.id;
    const def = rates.find((r) => r.product_line_id === null);
    setDefaultRate(def ? String(Number(def.rate)) : '');
    const ovs = rates.filter((r) => r.product_line_id !== null);
    setRows(ovs.map((r, i) => ({ key: i + 1, productLineId: r.product_line_id as string, rate: String(Number(r.rate)) })));
    setNextKey(ovs.length + 1);
  }, [member?.id, rates]);

  const lineName = (id: string) => productLines?.find((p) => p.id === id)?.name ?? t('payouts.productLine');

  const updateRow = (key: number, patch: Partial<OverrideRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = () => {
    if (!member) return;
    const parse = (s: string): number | null => (s.trim() === '' ? null : Number(s));
    const def = parse(defaultRate);
    const overrides = rows.map((r) => ({ product_line_id: r.productLineId, rate: parse(r.rate) }));
    if ((def !== null && Number.isNaN(def)) || overrides.some((o) => o.rate === null || Number.isNaN(o.rate))) {
      toast({ title: t('payouts.couldNotSaveRates'), description: t('payouts.rateRange'), variant: 'destructive' });
      return;
    }
    setRates.mutate(
      { userId: member.id, defaultRate: def, overrides: overrides.map((o) => ({ product_line_id: o.product_line_id, rate: o.rate as number })) },
      {
        onSuccess: () => {
          toast({ title: t('payouts.ratesSaved', { name: member.full_name }) });
          onOpenChange(false);
        },
        onError: (err: any) => toast({ title: t('payouts.couldNotSaveRates'), description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('payouts.ratesFor', { name: member?.full_name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('payouts.ratesDesc')}
            {!canEdit && ` ${t('payouts.ownerOnly')}`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-4 text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-rate">{t('payouts.defaultRate')}</Label>
              <Input
                id="default-rate"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                placeholder={t('payouts.none')}
                value={defaultRate}
                onChange={(e) => setDefaultRate(e.target.value)}
                disabled={!canEdit}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">{t('payouts.defaultHint')}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('payouts.overrides')}</Label>
              {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('payouts.noOverrides')}</p>}
              {rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <Select value={r.productLineId} onValueChange={(v) => updateRow(r.key, { productLineId: v })} disabled={!canEdit}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder={t('payouts.productLine')}>{r.productLineId ? lineName(r.productLineId) : undefined}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {(productLines ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    aria-label={t('payouts.overrideRate')}
                    placeholder="%"
                    value={r.rate}
                    onChange={(e) => updateRow(r.key, { rate: e.target.value })}
                    disabled={!canEdit}
                    className="w-24"
                  />
                  {canEdit && (
                    <Button variant="ghost" size="icon" aria-label={t('payouts.removeOverride')} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setRows((rs) => [...rs, { key: nextKey, productLineId: '', rate: '' }]); setNextKey((k) => k + 1); }}
                >
                  <Plus className="w-4 h-4 me-1" /> {t('payouts.addOverride')}
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{canEdit ? t('common.cancel') : t('common.close')}</Button>
          {canEdit && (
            <Button onClick={save} disabled={setRates.isPending || isLoading}>
              {setRates.isPending ? t('payouts.saving') : t('payouts.saveRates')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
