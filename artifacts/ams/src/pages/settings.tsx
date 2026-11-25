import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdateAgency, useAgencyUsers } from '@/hooks/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, Users, Building } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';
import { InviteMemberDialog } from '@/components/team/InviteMemberDialog';
import { RemoveMemberDialog } from '@/components/team/RemoveMemberDialog';
import { AgentRatesDialog } from '@/components/team/AgentRatesDialog';
import { Switch } from '@/components/ui/switch';
import { useSetAgentsManageRenewals } from '@/hooks/renewals';
import { usePendingInvites, useRevokeInvite, useChangeMemberRole, useClientCountsByAgent } from '@/hooks/team';
import { useForm } from 'react-hook-form';
import { BillingTab } from '@/components/billing/BillingTab';
import { ownerPlacesLeft, tierName, todayNairobi } from '@/lib/subscription';
import { LanguageCurrencyCard } from '@/components/settings/LanguageCurrencyCard';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

export default function Settings({ tab }: { tab?: string } = {}) {
  const { t } = useTranslation();
  const { agency, profile, session, isOwner, isOwnerOrManager } = useAuth();
  const updateAgency = useUpdateAgency();
  const { data: users, isLoading: usersLoading } = useAgencyUsers();
  const { toast } = useToast();
  const setAgentsManage = useSetAgentsManageRenewals();
  const { data: invites } = usePendingInvites();
  const { data: clientCounts } = useClientCountsByAgent();
  const revokeInvite = useRevokeInvite();
  const changeRole = useChangeMemberRole();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; full_name: string } | null>(null);
  const [ratesFor, setRatesFor] = useState<{ id: string; full_name: string } | null>(null);
  const activeUsers = users?.filter(u => !u.deactivated_at) ?? [];
  const removedUsers = users?.filter(u => u.deactivated_at) ?? [];
  const ownerFull = ownerPlacesLeft(
    agency?.subscription_tier ?? 'starter',
    !!agency?.complimentary_until && agency.complimentary_until >= todayNairobi(),
    activeUsers.filter(u => u.role === 'owner').length,
    (invites ?? []).filter(i => i.role === 'owner').length,
  ) === 0;

  const form = useForm({
    defaultValues: {
      name: agency?.name || '',
      email: agency?.email || '',
      phone: agency?.phone || '',
      address: agency?.address || '',
    }
  });

  const onSaveProfile = (values: any) => {
    if (!agency?.id) return;
    updateAgency.mutate({ id: agency.id, ...values }, {
      onSuccess: () => {
        toast({ title: t('agency.settingsUpdated') });
      }
    });
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="sr-only">{t('agency.settingsTitle')}</h1>
        <p className="text-muted-foreground">{t('agency.settingsSubtitle')}</p>
      </div>

      <Tabs defaultValue={tab === 'billing' && isOwner ? 'billing' : 'profile'} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">{t('agency.tabProfile')}</TabsTrigger>
          <TabsTrigger value="agency">{t('agency.tabAgency')}</TabsTrigger>
          {isOwnerOrManager && <TabsTrigger value="team">{t('agency.tabTeam')}</TabsTrigger>}
          {isOwner && <TabsTrigger value="billing">{t('agency.tabBilling')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="space-y-4 max-w-md">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building className="w-4 h-4 text-primary" />
                {t('agency.currentWorkspace')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{agency?.name}</div>
              <Badge variant="outline" className="mt-2 capitalize bg-background">{t('agency.planBadge', { tier: tierName(agency?.subscription_tier) })}</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                {t('agency.yourProfile')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-medium">{profile?.full_name}</div>
              <div className="text-sm text-muted-foreground">{profile?.email}</div>
              <Badge variant="secondary" className="mt-2 capitalize">{profile?.role ? t(`roles.${profile.role}`, { defaultValue: profile.role }) : ''}</Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agency">
          <Card>
            <CardHeader>
              <CardTitle>{t('agency.agencyProfile')}</CardTitle>
              <CardDescription>{isOwner ? t('agency.agencyProfileOwnerDesc') : t('agency.agencyProfileViewerDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSaveProfile)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('agency.agencyName')}</FormLabel>
                        <FormControl><Input {...field} disabled={!isOwner} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('agency.generalEmail')}</FormLabel>
                          <FormControl><Input type="email" {...field} disabled={!isOwner} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('agency.phoneNumber')}</FormLabel>
                          <FormControl><Input {...field} disabled={!isOwner} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('agency.physicalAddress')}</FormLabel>
                        <FormControl><Input {...field} disabled={!isOwner} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {isOwner && (
                    <Button type="submit" disabled={updateAgency.isPending}>
                      {updateAgency.isPending ? t('agency.saving') : t('agency.saveChanges')}
                    </Button>
                  )}
                </form>
              </Form>
            </CardContent>
          </Card>
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t('agency.renewals')}</CardTitle>
              <CardDescription>
                {t('agency.renewalsDesc')}{' '}
                {isOwner ? t('agency.renewalsOwnerNote') : t('agency.renewalsViewerNote')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="agents-manage-renewals" className="font-normal">
                  {t('agency.agentsManageRenewals')}
                  <span className="block text-xs text-muted-foreground">
                    {t('agency.agentsManageRenewalsHelp')}
                  </span>
                </Label>
                <Switch
                  id="agents-manage-renewals"
                  checked={agency?.agents_manage_renewals ?? true}
                  disabled={!isOwner || setAgentsManage.isPending}
                  onCheckedChange={(checked) =>
                    setAgentsManage.mutate(checked, {
                      onSuccess: () =>
                        toast({ title: checked ? t('agency.agentsCanNow') : t('agency.agentsOff') }),
                      onError: (err) => toast({ title: t('agency.couldNotSave'), description: err.message, variant: 'destructive' }),
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
          <LanguageCurrencyCard />
        </TabsContent>

        {isOwnerOrManager && (
          <TabsContent value="team" className="space-y-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" /> {t('agency.teamMembers')}
                  </CardTitle>
                  <CardDescription>{t('agency.teamMembersDesc')}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
                  {t('agency.inviteMember')}
                </Button>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('agency.colName')}</TableHead>
                        <TableHead>{t('agency.colEmail')}</TableHead>
                        <TableHead>{t('agency.colRole')}</TableHead>
                        <TableHead className="text-end">{t('agency.colClients')}</TableHead>
                        <TableHead className="text-end">{t('agency.colActions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersLoading ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-4">{t('common.loading')}</TableCell></TableRow>
                      ) : (
                        activeUsers.map(user => (
                          <TableRow key={user.id}>
                            <TableCell className="font-medium">{user.full_name}</TableCell>
                            <TableCell>{user.email}</TableCell>
                            <TableCell>
                              <Badge variant={user.role === 'owner' ? 'default' : 'secondary'} className="capitalize">
                                {t(`roles.${user.role}`, { defaultValue: user.role })}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-end">{clientCounts?.[user.id] ?? 0}</TableCell>
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setRatesFor({ id: user.id, full_name: user.full_name })}>
                                  {t('agency.rates')}
                                </Button>
                                {isOwner && user.id !== session?.id && (
                                  <>
                                    <Select
                                      value={user.role}
                                      onValueChange={(role) => changeRole.mutate(
                                        { userId: user.id, role: role as 'owner' | 'manager' | 'agent' },
                                        {
                                          onSuccess: () => toast({ title: t('agency.roleUpdated') }),
                                          onError: (err: any) => toast({ title: t('agency.couldNotChangeRole'), description: err.message, variant: 'destructive' }),
                                        },
                                      )}
                                    >
                                      <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="owner" disabled={ownerFull && user.role !== 'owner'}>{ownerFull && user.role !== 'owner' ? t('agency.ownerNoPlaces', { role: t('roles.owner') }) : t('roles.owner')}</SelectItem>
                                        <SelectItem value="manager">{t('roles.manager')}</SelectItem>
                                        <SelectItem value="agent">{t('roles.agent')}</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Button variant="outline" size="sm" onClick={() => setRemoving({ id: user.id, full_name: user.full_name })}>
                                      {t('agency.removeBtn')}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                {removedUsers.length > 0 && (
                  <div className="mt-6">
                    <div className="text-sm font-medium text-muted-foreground mb-2">{t('agency.removedHeading')}</div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {removedUsers.map(u => (
                        <li key={u.id}>{u.full_name}{u.email ? ` (${u.email})` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('agency.pendingInvites')}</CardTitle>
                <CardDescription>{t('agency.pendingInvitesDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('agency.colEmail')}</TableHead>
                        <TableHead>{t('agency.colRole')}</TableHead>
                        <TableHead>{t('agency.colExpires')}</TableHead>
                        <TableHead className="text-end"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!invites || invites.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">{t('agency.noPendingInvites')}</TableCell></TableRow>
                      ) : (
                        invites.map(invite => {
                          const canRevoke = isOwner || (invite.role === 'agent' && invite.invited_by === session?.id);
                          return (
                            <TableRow key={invite.id}>
                              <TableCell className="font-medium">{invite.email}</TableCell>
                              <TableCell><Badge variant="secondary" className="capitalize">{t(`roles.${invite.role}`, { defaultValue: invite.role })}</Badge></TableCell>
                              <TableCell>{formatDate(invite.expires_at)}</TableCell>
                              <TableCell className="text-end">
                                {canRevoke && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={revokeInvite.isPending}
                                    onClick={() => revokeInvite.mutate(invite.id, {
                                      onSuccess: () => toast({ title: t('agency.inviteRevoked') }),
                                      onError: (err: any) => toast({ title: t('agency.couldNotRevokeInvite'), description: err.message, variant: 'destructive' }),
                                    })}
                                  >
                                    {t('agency.revoke')}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
            <AgentRatesDialog member={ratesFor} canEdit={isOwner} onOpenChange={(o) => { if (!o) setRatesFor(null); }} />
            <RemoveMemberDialog member={removing} onOpenChange={(o) => { if (!o) setRemoving(null); }} />
          </TabsContent>
        )}
        {isOwner && (
          <TabsContent value="billing">
            <BillingTab welcome={new URLSearchParams(window.location.search).has('welcome')} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
