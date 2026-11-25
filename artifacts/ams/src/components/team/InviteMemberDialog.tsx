import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCreateInvite, inviteLink, usePendingInvites, type InviteResult } from '@/hooks/team';
import { useAgencyUsers } from '@/hooks/queries';
import { ownerPlacesLeft, todayNairobi, tierName } from '@/lib/subscription';
import { Copy, MessageCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { agency, isOwner } = useAuth();
  const { toast } = useToast();
  const createInvite = useCreateInvite();
  const { data: users } = useAgencyUsers();
  const { data: invites } = usePendingInvites();
  const owners = (users ?? []).filter((u) => u.role === 'owner' && !u.deactivated_at).length;
  const pendingOwners = (invites ?? []).filter((i) => i.role === 'owner').length;
  const comped = !!agency?.complimentary_until && agency.complimentary_until >= todayNairobi();
  const ownerPlaces = ownerPlacesLeft(agency?.subscription_tier ?? 'starter', comped, owners, pendingOwners);
  const ownerFull = ownerPlaces === 0;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'manager' | 'agent'>('agent');
  const [result, setResult] = useState<InviteResult | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // The link is shown once; closing discards it.
      setResult(null);
      setEmail('');
      setRole('agent');
    }
    onOpenChange(next);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createInvite.mutate(
      { email: email.trim(), role: isOwner ? role : 'agent' },
      {
        onSuccess: (data) => setResult(data),
        onError: (err: any) => toast({ title: t('agency.couldNotCreateInvite'), description: err.message, variant: 'destructive' }),
      },
    );
  };

  const link = result ? inviteLink(result.code) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: t('agency.linkCopied') });
    } catch {
      toast({ title: t('agency.couldNotCopy'), description: t('agency.copyManually'), variant: 'destructive' });
    }
  };

  const message = t('agency.inviteMessage', { agency: agency?.name ?? t('agency.fallbackAgency'), link });
  const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(message);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('agency.inviteCreated')}</DialogTitle>
              <DialogDescription>{t('agency.sendLinkTo', { email: email.trim() })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input readOnly value={link} onFocus={(e) => e.target.select()} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={copy}>
                  <Copy className="w-4 h-4 me-2" /> {t('agency.copyLink')}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="w-4 h-4 me-2" /> {t('agency.shareWhatsapp')}
                  </a>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{t('agency.linkOnce')}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>{t('agency.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t('agency.inviteMember')}</DialogTitle>
              <DialogDescription>{t('agency.inviteMemberDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('agency.colEmail')}</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('agency.colRole')}</Label>
              <Select value={isOwner ? role : 'agent'} onValueChange={(v) => setRole(v as 'owner' | 'manager' | 'agent')} disabled={!isOwner}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isOwner && <SelectItem value="owner" disabled={ownerFull}>{ownerFull ? t('agency.ownerNoPlaces', { role: t('roles.owner') }) : t('roles.owner')}</SelectItem>}
                  {isOwner && <SelectItem value="manager">{t('roles.manager')}</SelectItem>}
                  <SelectItem value="agent">{t('roles.agent')}</SelectItem>
                </SelectContent>
              </Select>
              {isOwner && ownerFull && (
                <p className="text-xs text-muted-foreground">
                  {t('agency.ownerPlanFull', { tier: tierName(agency?.subscription_tier) })}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={createInvite.isPending || !email.trim()}>
                {createInvite.isPending ? t('agency.creating') : t('agency.createInvite')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
