import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadAction } from '@/hooks/leads';
import { useProductLines } from '@/hooks/queries';
import { useAgencyMembers } from '@/hooks/team';
import { SOURCES, type Lead } from '@/lib/leads';

const NONE = '__none__';

/** Add a lead, or edit an existing lead's details. */
export function LeadForm({ open, onOpenChange, lead, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead?: Lead | null;
  onSaved?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { isOwnerOrManager, session } = useAuth();
  const { data: productLines } = useProductLines();
  const { data: members } = useAgencyMembers();
  const act = useLeadAction();
  const [f, setF] = useState({ full_name: '', phone: '', email: '', interest: '', product_line_id: NONE, source: NONE, notes: '', assigned_agent_id: '' });

  useEffect(() => {
    if (!open) return;
    act.reset();
    setF({
      full_name: lead?.full_name ?? '',
      phone: lead?.phone ?? '',
      email: lead?.email ?? '',
      interest: lead?.interest ?? '',
      product_line_id: lead?.product_line_id ?? NONE,
      source: lead?.source ?? NONE,
      notes: lead?.notes ?? '',
      assigned_agent_id: lead?.assigned_agent_id ?? session?.id ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id]);

  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = () => {
    const p: Record<string, unknown> = {
      full_name: f.full_name,
      phone: f.phone,
      email: f.email,
      interest: f.interest,
      product_line_id: f.product_line_id === NONE ? '' : f.product_line_id,
      source: f.source === NONE ? '' : f.source,
      notes: f.notes,
    };
    if (lead) {
      act.mutate({ rpc: 'update_lead', args: { p_lead_id: lead.id, p } }, { onSuccess: () => { onSaved?.(lead.id); onOpenChange(false); } });
    } else {
      if (isOwnerOrManager) p.assigned_agent_id = f.assigned_agent_id;
      act.mutate({ rpc: 'create_lead', args: { p } }, { onSuccess: (id) => { onSaved?.(id as string); onOpenChange(false); } });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? t('workspace.form.edit') : t('workspace.form.add')}</DialogTitle>
          <DialogDescription>{t('workspace.form.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="lead-name">{t('workspace.form.name')}</Label>
            <Input id="lead-name" value={f.full_name} onChange={(e) => set('full_name')(e.target.value)} placeholder="Mary Wanjiku" required autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-phone">{t('workspace.form.phone')}</Label>
              <Input id="lead-phone" type="tel" value={f.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="0712 345 678" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-email">{t('workspace.form.email')}</Label>
              <Input id="lead-email" type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-interest">{t('workspace.form.interest')}</Label>
            <Input id="lead-interest" value={f.interest} onChange={(e) => set('interest')(e.target.value)} placeholder={t('workspace.form.interestPlaceholder')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t('workspace.form.productLine')}</Label>
              <Select value={f.product_line_id} onValueChange={set('product_line_id')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('workspace.form.notDecided')}</SelectItem>
                  {productLines?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('workspace.form.source')}</Label>
              <Select value={f.source} onValueChange={set('source')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('workspace.form.notRecorded')}</SelectItem>
                  {SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{t(`workspace.source.${s.value}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!lead && isOwnerOrManager && (
            <div className="grid gap-1.5">
              <Label>{t('workspace.form.agent')}</Label>
              <Select value={f.assigned_agent_id} onValueChange={set('assigned_agent_id')}>
                <SelectTrigger><SelectValue placeholder={t('workspace.form.pickAgent')} /></SelectTrigger>
                <SelectContent>
                  {members?.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="lead-notes">{t('workspace.form.notes')}</Label>
            <Textarea id="lead-notes" rows={2} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
          </div>
          {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={act.isPending}>
              {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {lead ? t('workspace.form.saveChanges') : t('workspace.form.addLead')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
