import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAgencyMembers, useRemoveMember } from '@/hooks/team';

interface Props {
  member: { id: string; full_name: string } | null;
  onOpenChange: (open: boolean) => void;
}

export function RemoveMemberDialog({ member, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: members } = useAgencyMembers();
  const removeMember = useRemoveMember();
  const [reassignTo, setReassignTo] = useState('');

  useEffect(() => {
    setReassignTo('');
  }, [member?.id]);

  const options = (members ?? []).filter((m) => m.id !== member?.id);

  const confirm = () => {
    if (!member || !reassignTo) return;
    removeMember.mutate(
      { userId: member.id, reassignTo },
      {
        onSuccess: (res) => {
          toast({
            title: t('agency.removedToast', {
              clients: t('agency.clientsCount', { count: res.clients_moved }),
              policies: t('agency.policiesCount', { count: res.policies_moved }),
            }),
          });
          onOpenChange(false);
        },
        onError: (err: any) => toast({ title: t('agency.couldNotRemove'), description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('agency.removeTitle', { name: member?.full_name })}</DialogTitle>
          <DialogDescription>
            {t('agency.removeDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t('agency.reassignLabel')}</Label>
          <Select value={reassignTo} onValueChange={setReassignTo}>
            <SelectTrigger><SelectValue placeholder={t('agency.selectMember')} /></SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={confirm} disabled={!reassignTo || removeMember.isPending}>
            {removeMember.isPending ? t('agency.removing') : t('agency.removeMember')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
