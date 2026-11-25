import { getCurrency } from '@/lib/money';
import React, { useState, useEffect } from 'react';
import { useRoute } from 'wouter';
import { useClient, useUpdateClient, usePolicies, useInsurers, useProductLines, useCreatePolicy, useDeletePolicy } from '@/hooks/queries';
import { useAgencyMembers, useReassignClient } from '@/hooks/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Edit, FileText, ArrowLeft, Building2, User, Plus, Trash2, UserCog } from 'lucide-react';
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useTranslation } from 'react-i18next';
import { commissionFields, refineCommission, withCommissionColumns, commissionDefaults } from '@/lib/policy-form';
import { PolicyCommissionFields } from '@/components/PolicyCommissionFields';
import { RenewalBadges } from '@/components/renewals/RenewalBadges';
import { useRenewalForPolicies } from '@/hooks/renewals';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';

const makePolicySchema = (t: (key: string) => string) => z.object({
  insurer_id: z.string().min(1, t('clients.required')),
  product_line_id: z.string().min(1, t('clients.required')),
  agent_id: z.string().min(1, t('clients.required')),
  policy_number: z.string().min(1, t('clients.required')),
  premium_amount: z.coerce.number().min(1, t('clients.mustBePositive')),
  commission_rate: z.coerce.number().min(0).max(100),
  start_date: z.string().min(1, t('clients.required')),
  expiry_date: z.string().min(1, t('clients.required')),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']),
  notes: z.string().optional(),
  ...commissionFields,
}).superRefine(refineCommission);

type PolicyFormValues = z.infer<ReturnType<typeof makePolicySchema>>;

export default function ClientDetail() {
  const { t } = useTranslation();
  const policySchema = React.useMemo(() => makePolicySchema(t), [t]);
  const [, params] = useRoute('/clients/:id');
  const clientId = params?.id || '';
  const { session, profile, isOwnerOrManager } = useAuth();
  
  const { data: client, isLoading: isClientLoading } = useClient(clientId);
  const { data: policies, isLoading: isPoliciesLoading } = usePolicies({ clientId });
  const { data: renewalInfo } = useRenewalForPolicies((policies ?? []).map((p) => p.id));
  const numberById = Object.fromEntries((policies ?? []).map((p) => [p.id, p.policy_number]));
  const { data: insurers } = useInsurers();
  const { data: productLines } = useProductLines();
  const { data: members } = useAgencyMembers();
  const reassignClient = useReassignClient();
  
  const updateClient = useUpdateClient();
  const createPolicy = useCreatePolicy();
  const deletePolicy = useDeletePolicy();
  const { toast } = useToast();
  
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [isAddPolicyOpen, setIsAddPolicyOpen] = useState(false);
  const [deletePolicyId, setDeletePolicyId] = useState<string | null>(null);
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [newAgentId, setNewAgentId] = useState('');
  
  const form = useForm({
    resolver: zodResolver(policySchema),
    defaultValues: {
      insurer_id: '',
      product_line_id: '',
      agent_id: session?.id || profile?.id || '',
      policy_number: '',
      premium_amount: 0,
      commission_rate: 10,
      start_date: new Date().toISOString().split('T')[0],
      expiry_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
      status: 'active' as const,
      notes: '',
      ...commissionDefaults,
    },
  });
  
  // Set default agent_id when profile loads
  useEffect(() => {
    if (profile?.id && !form.getValues('agent_id')) {
      form.setValue('agent_id', profile.id);
    }
  }, [profile?.id, form]);

  if (isClientLoading) return <div className="p-8">{t('clients.loadingClient')}</div>;
  if (!client) return <div className="p-8">{t('clients.notFound')}</div>;

  const onAddPolicy = (values: PolicyFormValues) => {
    createPolicy.mutate(withCommissionColumns({
      ...values,
      // Agents never choose an agent: policies are always recorded against themselves
      agent_id: isOwnerOrManager ? values.agent_id : (session?.id ?? values.agent_id),
      client_id: clientId,
    }), {
      onSuccess: () => {
        toast({ title: t('clients.policyAdded') });
        setIsAddPolicyOpen(false);
        form.reset();
      },
      onError: (err) => {
        toast({ title: t('clients.errorAddingPolicy'), description: err.message, variant: 'destructive' });
      }
    });
  };

  const handleReassign = () => {
    if (!newAgentId) return;
    reassignClient.mutate({ clientId, newAgentId }, {
      onSuccess: (result) => {
        toast({ title: t('clients.reassigned', { count: result.policies_moved }) });
        setIsReassignOpen(false);
        setNewAgentId('');
      },
      onError: (err) => {
        toast({ title: t('clients.couldNotReassign'), description: err.message, variant: 'destructive' });
      }
    });
  };

  const handleDeletePolicy = () => {
    if (!deletePolicyId) return;
    deletePolicy.mutate(deletePolicyId, {
      onSuccess: () => {
        toast({ title: t('clients.policyDeleted') });
        setDeletePolicyId(null);
      },
      onError: (err) => {
        toast({ title: t('clients.errorDeletingPolicy'), description: err.message, variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" aria-label={t('clients.back')} onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{client.name}</h1>
            <Badge variant={client.type === 'corporate' ? 'default' : 'secondary'} className="gap-1">
              {client.type === 'corporate' ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
              <span>{client.type === 'corporate' ? t('clients.corporate') : t('clients.individual')}</span>
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">{t('clients.contactInfo')}</CardTitle>
            <Button variant="ghost" size="icon" aria-label={t('clients.editAria')} onClick={() => setIsEditClientOpen(true)}>
              <Edit className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">{t('clients.emailLabel')}</div>
              <div>{client.email || '-'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">{t('clients.phoneLabel')}</div>
              <div>{client.phone || '-'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">{t('clients.addressLabel')}</div>
              <div>{client.address || '-'}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">{t('clients.assignedTo')}</div>
              <div className="flex items-center justify-between gap-2">
                <span data-testid="text-client-assignee">{client.assigned_agent?.full_name ?? '—'}</span>
                {isOwnerOrManager && (
                  <Button variant="outline" size="sm" onClick={() => setIsReassignOpen(true)} data-testid="button-reassign-client">
                    <UserCog className="w-4 h-4 me-2" /> {t('clients.reassign')}
                  </Button>
                )}
              </div>
            </div>
            <div className="pt-4 border-t">
              <div className="text-sm font-medium text-muted-foreground">{t('clients.identifiers')}</div>
              <div className="grid grid-cols-2 mt-2">
                <div>
                  <div className="text-xs text-muted-foreground">{t('clients.kraPin')}</div>
                  <div className="text-sm font-medium">{client.kra_pin || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{client.type === 'corporate' ? t('clients.regNo') : t('clients.idNo')}</div>
                  <div className="text-sm font-medium">{client.id_or_reg_number || '-'}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">{t('clients.policies')}</CardTitle>
            
            <Dialog open={isAddPolicyOpen} onOpenChange={setIsAddPolicyOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 me-2" /> {t('clients.addPolicy')}</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('clients.addPolicyTitle', { name: client.name })}</DialogTitle>
                  <DialogDescription>{t('clients.addPolicyDesc')}</DialogDescription>
                </DialogHeader>
                
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onAddPolicy)} className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="insurer_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.insurer')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder={t('clients.selectInsurer')} /></SelectTrigger></FormControl>
                              <SelectContent>
                                {insurers?.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="product_line_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.productLine')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder={t('clients.selectProduct')} /></SelectTrigger></FormControl>
                              <SelectContent>
                                {productLines?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="policy_number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.policyNumber')}</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.status')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="active">{t('clients.statusActive')}</SelectItem>
                                <SelectItem value="pending">{t('clients.statusPending')}</SelectItem>
                                <SelectItem value="expired">{t('clients.statusExpired')}</SelectItem>
                                <SelectItem value="cancelled">{t('clients.statusCancelled')}</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="premium_amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.premium', { currency: getCurrency() })}</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="commission_rate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.commissionRate')}</FormLabel>
                            <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="p-3 bg-muted/50 rounded-md text-sm flex justify-between items-center">
                      <span className="font-medium text-muted-foreground">{t('clients.expectedCommission')}</span>
                      <span className="font-bold">
                        {formatCurrency((form.watch('premium_amount') || 0) * (form.watch('commission_rate') || 0) / 100)}
                      </span>
                    </div>

                    <PolicyCommissionFields form={form} productLines={productLines} />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="start_date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.startDate')}</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="expiry_date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.expiryDate')}</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    {isOwnerOrManager && (
                      <FormField
                        control={form.control}
                        name="agent_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.assignedAgent')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {members?.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <Button type="submit" className="w-full mt-4" disabled={createPolicy.isPending}>
                      {createPolicy.isPending ? t('clients.saving') : t('clients.savePolicy')}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            {isPoliciesLoading ? (
              <div className="p-4 text-center">{t('clients.loadingPolicies')}</div>
            ) : !policies || policies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-t">
                <FileText className="h-12 w-12 mb-4 opacity-20" />
                <p>{t('clients.noPolicies')}</p>
              </div>
            ) : (
              <div className="border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('clients.colPolicyNo')}</TableHead>
                      <TableHead>{t('clients.colDetails')}</TableHead>
                      <TableHead className="text-end">{t('clients.colPremium')}</TableHead>
                      <TableHead>{t('clients.colStatus')}</TableHead>
                      {isOwnerOrManager && <TableHead className="w-[50px]"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policies.map(policy => (
                      <TableRow key={policy.id}>
                        <TableCell className="font-medium">
                          {policy.policy_number}
                          <RenewalBadges policyId={policy.id} info={renewalInfo} numberById={numberById} />
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{policy.product_line?.name}</div>
                          <div className="text-xs text-muted-foreground">{policy.insurer?.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">{t('clients.expShort', { date: formatDate(policy.expiry_date) })}</div>
                        </TableCell>
                        <TableCell className="text-end font-medium">
                          {formatCurrency(policy.premium_amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusColor(policy.status)} className="capitalize">
                            {t(`clients.status${policy.status.charAt(0).toUpperCase()}${policy.status.slice(1)}`, { defaultValue: policy.status })}
                          </Badge>
                        </TableCell>
                        {isOwnerOrManager && (
                          <TableCell>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" aria-label={t('clients.deletePolicyAria')} onClick={() => setDeletePolicyId(policy.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isReassignOpen} onOpenChange={(open) => { setIsReassignOpen(open); if (!open) setNewAgentId(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clients.reassignTitle', { name: client.name })}</DialogTitle>
            <DialogDescription>
              {t('clients.reassignDesc')}
            </DialogDescription>
          </DialogHeader>
          <Select value={newAgentId} onValueChange={setNewAgentId}>
            <SelectTrigger data-testid="select-reassign-agent"><SelectValue placeholder={t('clients.selectMember')} /></SelectTrigger>
            <SelectContent>
              {members?.filter(m => m.id !== client.assigned_agent_id).map(m => (
                <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReassignOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleReassign} disabled={!newAgentId || reassignClient.isPending}>
              {reassignClient.isPending ? t('clients.reassigning') : t('clients.reassign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePolicyId} onOpenChange={(open) => !open && setDeletePolicyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clients.deletePolicyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('clients.deletePolicyDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletePolicyId(null)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePolicy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deletePolicy.isPending}>
              {deletePolicy.isPending ? t('clients.deleting') : t('clients.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
