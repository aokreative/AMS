import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExchangeRates } from '@/hooks/fx';
import { fromKes } from '@/lib/fx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EDITABLE = [
  { code: 'USD', hint: 'KES for 1 US dollar' },
  { code: 'TZS', hint: 'KES for 1 Tanzanian shilling' },
  { code: 'UGX', hint: 'KES for 1 Ugandan shilling' },
] as const;

/**
 * Superadmin: the rates used to show plan prices in an agency's own currency.
 * Display only: Paystack always charges the KES price.
 */
export function ExchangeRatesCard() {
  const qc = useQueryClient();
  const { data: rates, isLoading } = useExchangeRates();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async ({ currency, value }: { currency: string; value: number }) => {
      const { error } = await supabase.rpc('admin_set_exchange_rate', { p_currency: currency, p_kes_per_unit: value });
      if (error) throw error;
      return currency;
    },
    onSuccess: (currency) => {
      setSaved(currency);
      setDraft((d) => {
        const next = { ...d };
        delete next[currency];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Exchange rates</CardTitle>
        <CardDescription>
          Agencies outside Kenya see plan prices in their own currency at these rates. Paystack still charges the KES price.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        <div className="grid gap-4 sm:grid-cols-3">
          {EDITABLE.map(({ code, hint }) => {
            const current = rates?.[code];
            const value = draft[code] ?? (current != null ? String(current) : '');
            const n = Number(value);
            const valid = value.trim() !== '' && Number.isFinite(n) && n > 0;
            const changed = valid && n !== current;
            const example = valid ? fromKes(3500, code, { [code]: n }) : null;
            return (
              <form
                key={code}
                className="space-y-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (changed) save.mutate({ currency: code, value: n });
                }}
              >
                <Label htmlFor={`rate-${code}`}>{code}</Label>
                <div className="flex gap-2">
                  <Input
                    id={`rate-${code}`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => {
                      setSaved(null);
                      setDraft((d) => ({ ...d, [code]: e.target.value }));
                    }}
                  />
                  <Button type="submit" size="sm" disabled={!changed || save.isPending}>
                    {save.isPending && save.variables?.currency === code ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : saved === code && !changed ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {hint}
                  {example != null && ` · Starter shows ≈ ${code} ${example.toLocaleString('en-US')}`}
                </p>
              </form>
            );
          })}
        </div>
        {save.error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {(save.error as Error).message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
