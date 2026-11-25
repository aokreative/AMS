import { getCurrency } from '@/lib/money';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePolicies, useInsurers, useProductLines, useClients, useCreatePolicy, useUpdatePolicy, useDeletePolicy } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils';
import { Search, Plus, Filter, MoreHorizontal, Edit, Trash2, Download } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { RenewalBadges } from '@/components/renewals/RenewalBadges';
import { useRenewalForPolicies } from '@/hooks/renewals';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { commissionFields, refineCommission, withCommissionColumns, commissionDefaults } from '@/lib/policy-form';
import { PolicyCommissionFields } from '@/components/PolicyCommissionFields';
import { useAgencyMembers } from '@/hooks/team';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Policy } from '@/lib/types';
import { exportToCsv } from '@/lib/csv-export';

const makePolicySchema = (t: TFunction) => z.object({
  client_id: z.string().min(1, t('policies.required')),
  insurer_id: z.string().min(1, t('policies.required')),
  product_line_id: z.string().min(1, t('policies.required')),
  agent_id: z.string().min(1, t('policies.required')),
  policy_number: z.string().min(1, t('policies.required')),
  premium_amount: z.coerce.number().min(1, t('policies.mustBePositive')),
  commission_rate: z.coerce.number().min(0).max(100),
  start_date: z.string().min(1, t('policies.required')),
  expiry_date: z.string().min(1, t('policies.required')),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']),
  notes: z.string().optional(),
  ...commissionFields,
}).superRefine(refineCommission);

type PolicyFormValues = z.infer<ReturnType<typeof makePolicySchema>>;

export default function Policies() {
  const { t } = useTranslation();
  const policySchema = useMemo(() => makePolicySchema(t), [t]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [insurerFilter, setInsurerFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const { session, profile, isOwnerOrManager } = useAuth();
  const { toast } = useToast();
  
  const { data: policies, isLoading } = usePolicies({ 
    status: statusFilter,
    insurerId: insurerFilter 
  });
  
  const { data: clients } = useClients();
  const { data: insurers } = useInsurers();
  const { data: productLines } = useProductLines();
  const { data: users } = useAgencyMembers();
  
  const createPolicy = useCreatePolicy();
  const deletePolicy = useDeletePolicy();

  const form = useForm({
    resolver: zodResolver(policySchema),
    defaultValues: {
      client_id: '',
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

  const policyIds = (policies ?? []).map((p) => p.id);
  const { data: renewalInfo } = useRenewalForPolicies(policyIds);
  const numberById = Object.fromEntries((policies ?? []).map((p) => [p.id, p.policy_number]));

  const filteredPolicies = policies?.filter(p => 
    p.policy_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const onSubmit = (values: PolicyFormValues) => {
    // Agents never choose an agent: policies are always recorded against themselves
    createPolicy.mutate(withCommissionColumns(isOwnerOrManager ? values : { ...values, agent_id: session?.id ?? values.agent_id }), {
      onSuccess: () => {
        toast({ title: t('policies.policyCreated') });
        setIsAddOpen(false);
        form.reset();
      },
      onError: (err) => {
        toast({ title: t('policies.error'), description: err.message, variant: 'destructive' });
      }
    });
  };
  
  const handleDelete = () => {
    if (!deleteId) return;
    deletePolicy.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: t('policies.policyDeleted') });
        setDeleteId(null);
      }
    });
  };

  const handleExportCsv = () => {
    if (!policies) return;
    const exportData = policies.map(p => ({
      policy_number: p.policy_number,
      client_name: p.client?.name || '',
      insurer_name: p.insurer?.name || '',
      product_line: p.product_line?.name || '',
      status: p.status,
      premium_amount: p.premium_amount,
      commission_rate: p.commission_rate,
      commission_expected: p.commission_expected,
      commission_received: p.commission_received,
      start_date: p.start_date,
      expiry_date: p.expiry_date
    }));
    exportToCsv('policies', exportData);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="sr-only">{t('policies.title')}</h1>
          <p className="text-muted-foreground">{t('policies.subtitle')}</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 me-2" /> {t('policies.createPolicy')}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('policies.createTitle')}</DialogTitle>
              <DialogDescription>{t('policies.createDescription')}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="client_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('policies.client')}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t('policies.selectClient')} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="insurer_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('policies.insurer')}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t('policies.selectInsurer')} /></SelectTrigger></FormControl>
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
                        <FormLabel>{t('policies.productLine')}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t('policies.selectProduct')} /></SelectTrigger></FormControl>
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
                        <FormLabel>{t('policies.policyNumber')}</FormLabel>
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
                        <FormLabel>{t('policies.status')}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="active">{t('policies.statuses.active')}</SelectItem>
                            <SelectItem value="pending">{t('policies.statuses.pending')}</SelectItem>
                            <SelectItem value="expired">{t('policies.statuses.expired')}</SelectItem>
                            <SelectItem value="cancelled">{t('policies.statuses.cancelled')}</SelectItem>
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
                        <FormLabel>{t('policies.premium', { currency: getCurrency() })}</FormLabel>
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
                        <FormLabel>{t('policies.commissionRate')}</FormLabel>
                        <FormControl><Input type="number" step="0.1" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <PolicyCommissionFields form={form} productLines={productLines} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="start_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('policies.startDate')}</FormLabel>
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
                        <FormLabel>{t('policies.expiryDate')}</FormLabel>
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
                        <FormLabel>{t('policies.assignedAgent')}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <Button type="submit" className="w-full mt-4" disabled={createPolicy.isPending}>
                  {createPolicy.isPending ? t('policies.saving') : t('policies.savePolicy')}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('policies.searchPlaceholder')}
            className="ps-9 bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExportCsv}>
            <Download className="w-4 h-4 me-2" /> {t('policies.exportCsv')}
          </Button>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] bg-card"><SelectValue placeholder={t('policies.status')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('policies.allStatuses')}</SelectItem>
              <SelectItem value="active">{t('policies.statuses.active')}</SelectItem>
              <SelectItem value="pending">{t('policies.statuses.pending')}</SelectItem>
              <SelectItem value="expired">{t('policies.statuses.expired')}</SelectItem>
              <SelectItem value="cancelled">{t('policies.statuses.cancelled')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={insurerFilter} onValueChange={setInsurerFilter}>
            <SelectTrigger className="w-[180px] bg-card"><SelectValue placeholder={t('policies.insurer')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('policies.allInsurers')}</SelectItem>
              {insurers?.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('policies.colPolicyClient')}</TableHead>
                <TableHead>{t('policies.colProductInsurer')}</TableHead>
                <TableHead className="text-end">{t('policies.colPremium')}</TableHead>
                <TableHead className="text-end">{t('policies.colExpectedComm')}</TableHead>
                <TableHead>{t('policies.colDates')}</TableHead>
                <TableHead>{t('policies.colStatus')}</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">{t('policies.loading')}</TableCell></TableRow>
              ) : filteredPolicies?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">{t('policies.noPolicies')}</TableCell></TableRow>
              ) : (
                filteredPolicies?.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <div className="font-medium text-primary">{policy.policy_number}</div>
                      <div className="text-sm font-medium">{policy.client?.name ?? '—'}</div>
                      <RenewalBadges policyId={policy.id} info={renewalInfo} numberById={numberById} />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{policy.product_line?.name}</div>
                      <div className="text-xs text-muted-foreground">{policy.insurer?.name}</div>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="font-medium">{formatCurrency(policy.premium_amount)}</div>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="font-medium text-emerald-600 dark:text-emerald-500">
                        {formatCurrency(policy.commission_expected)}
                      </div>
                      <div className="text-xs text-muted-foreground">{policy.commission_rate}%</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDate(policy.start_date)}</div>
                      <div className="text-xs text-muted-foreground">{t('policies.toDate', { date: formatDate(policy.expiry_date) })}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusColor(policy.status)} className="capitalize">
                        {t(`policies.statuses.${policy.status}`, { defaultValue: policy.status })}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">{t('policies.openMenu')}</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>{t('policies.actions')}</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => {}} disabled>
                            <Edit className="me-2 h-4 w-4" /> {t('policies.editPolicy')}
                          </DropdownMenuItem>
                          {isOwnerOrManager && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:bg-destructive/10" onClick={() => setDeleteId(policy.id)}>
                                <Trash2 className="me-2 h-4 w-4" /> {t('policies.deletePolicy')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      
      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('policies.deletePolicy')}</DialogTitle>
            <DialogDescription>
              {t('policies.deleteDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deletePolicy.isPending}>
              {deletePolicy.isPending ? t('policies.deleting') : t('policies.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
