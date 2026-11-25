import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useClients, useCreateClient, useUpdateClient, useDeleteClient } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Building2, User, Download, Edit, Trash2 } from 'lucide-react';
import { 
  Sheet, 
  SheetContent, 
  SheetDescription, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useAgencyMembers } from '@/hooks/team';
import { ClientType } from '@/lib/types';
import { exportToCsv } from '@/lib/csv-export';

const makeClientSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(2, t('clients.nameRequired')),
  type: z.enum(['individual', 'corporate'] as const),
  phone: z.string().optional().nullable(),
  email: z.string().email(t('clients.invalidEmail')).optional().or(z.literal('')).nullable(),
  kra_pin: z.string().optional().nullable(),
  id_or_reg_number: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

type ClientFormValues = z.infer<ReturnType<typeof makeClientSchema>>;

export default function Clients() {
  const { t } = useTranslation();
  const clientSchema = React.useMemo(() => makeClientSchema(t), [t]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [, setLocation] = useLocation();
  const { data: clients, isLoading } = useClients();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const { toast } = useToast();
  const { session, isOwnerOrManager } = useAuth();
  const { data: members } = useAgencyMembers();
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [assigneeId, setAssigneeId] = useState<string>(session?.id ?? '');

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: '',
      type: 'individual',
      phone: '',
      email: '',
      kra_pin: '',
      id_or_reg_number: '',
      address: '',
    },
  });

  const filteredClients = clients?.filter(c =>
    (assigneeFilter === 'all' || c.assigned_agent_id === assigneeFilter) &&
    (c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone?.includes(searchTerm) ||
    c.kra_pin?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const onSubmit = (values: ClientFormValues) => {
    if (editingClient) {
      updateClient.mutate({ id: editingClient.id, ...values }, {
        onSuccess: () => {
          toast({ title: t('clients.updated') });
          setIsAddSheetOpen(false);
          setEditingClient(null);
          form.reset();
        },
        onError: (error) => {
          toast({ title: t('clients.errorUpdating'), description: error.message, variant: 'destructive' });
        }
      });
    } else {
      createClient.mutate(isOwnerOrManager && assigneeId ? { ...values, assigned_agent_id: assigneeId } : values, {
        onSuccess: () => {
          toast({ title: t('clients.created') });
          setIsAddSheetOpen(false);
          form.reset();
        },
        onError: (error) => {
          toast({ title: t('clients.errorCreating'), description: error.message, variant: 'destructive' });
        }
      });
    }
  };

  const openEdit = (client: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClient(client);
    form.reset({
      name: client.name,
      type: client.type,
      phone: client.phone || '',
      email: client.email || '',
      kra_pin: client.kra_pin || '',
      id_or_reg_number: client.id_or_reg_number || '',
      address: client.address || '',
    });
    setIsAddSheetOpen(true);
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteClient.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: t('clients.deleted') });
        setDeleteId(null);
      },
      onError: (error) => {
        toast({ title: t('clients.errorDeleting'), description: error.message, variant: 'destructive' });
      }
    });
  };

  const handleExportCsv = () => {
    if (!clients) return;
    const exportData = clients.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      email: c.email || '',
      phone: c.phone || '',
      kra_pin: c.kra_pin || '',
      address: c.address || '',
      created_at: c.created_at
    }));
    exportToCsv('clients', exportData);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="sr-only">{t('clients.title')}</h1>
          <p className="text-muted-foreground">{t('clients.subtitle')}</p>
        </div>
        
        <Sheet open={isAddSheetOpen} onOpenChange={(open) => {
          setIsAddSheetOpen(open);
          if (!open) {
            setEditingClient(null);
            setAssigneeId(session?.id ?? '');
            form.reset({ name: '', type: 'individual', phone: '', email: '', kra_pin: '', id_or_reg_number: '', address: '' });
          }
        }}>
          <SheetTrigger asChild>
            <Button data-testid="button-add-client">
              <Plus className="w-4 h-4 me-2" /> {t('clients.add')}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{editingClient ? t('clients.editTitle') : t('clients.addTitle')}</SheetTitle>
              <SheetDescription>
                {editingClient ? t('clients.editDesc') : t('clients.addDesc')}
              </SheetDescription>
            </SheetHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('clients.clientType')}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('clients.selectType')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="individual">{t('clients.individual')}</SelectItem>
                          <SelectItem value="corporate">{t('clients.corporate')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('clients.nameLabel')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('clients.namePlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('clients.phone')}</FormLabel>
                        <FormControl>
                          <Input placeholder="07XX XXX XXX" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('clients.email')}</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="email@example.com" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="kra_pin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('clients.kraPin')}</FormLabel>
                        <FormControl>
                          <Input placeholder="A000000000A" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="id_or_reg_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{form.watch('type') === 'corporate' ? t('clients.regNumber') : t('clients.idNumber')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('clients.numberPlaceholder')} {...field} value={field.value || ''} />
                        </FormControl>
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
                      <FormLabel>{t('clients.address')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('clients.addressPlaceholder')} {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isOwnerOrManager && !editingClient && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t('clients.assignedTo')}</div>
                    <Select value={assigneeId} onValueChange={setAssigneeId}>
                      <SelectTrigger data-testid="select-client-assignee"><SelectValue placeholder={t('clients.selectMember')} /></SelectTrigger>
                      <SelectContent>
                        {members?.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="pt-4">
                  <Button type="submit" className="w-full" disabled={createClient.isPending || updateClient.isPending}>
                    {createClient.isPending || updateClient.isPending ? t('clients.saving') : t('clients.saveClient')}
                  </Button>
                </div>
              </form>
            </Form>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('clients.searchPlaceholder')}
            className="ps-9 bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {isOwnerOrManager && (
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-[180px] bg-card" data-testid="filter-assigned-to"><SelectValue placeholder={t('clients.assignedToPlaceholder')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('clients.allMembers')}</SelectItem>
              {members?.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="secondary" size="sm" onClick={handleExportCsv} className="ms-auto">
          <Download className="w-4 h-4 me-2" /> {t('clients.exportCsv')}
        </Button>
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('clients.colName')}</TableHead>
              <TableHead>{t('clients.colType')}</TableHead>
              <TableHead>{t('clients.colContact')}</TableHead>
              <TableHead>{t('clients.colIdentifiers')}</TableHead>
              <TableHead>{t('clients.assignedTo')}</TableHead>
              <TableHead className="text-end">{t('clients.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">{t('clients.loading')}</TableCell>
              </TableRow>
            ) : filteredClients?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {t('clients.empty')} {searchTerm && t('clients.emptySearch')}
                </TableCell>
              </TableRow>
            ) : (
              filteredClients?.map((client) => (
                <TableRow 
                  key={client.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setLocation(`/clients/${client.id}`)}
                >
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>
                    <Badge variant={client.type === 'corporate' ? 'default' : 'secondary'} className="gap-1">
                      {client.type === 'corporate' ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                      <span>{client.type === 'corporate' ? t('clients.corporate') : t('clients.individual')}</span>
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{client.phone || '-'}</div>
                    <div className="text-xs text-muted-foreground">{client.email || '-'}</div>
                  </TableCell>
                  <TableCell>
                    {client.kra_pin && <div className="text-sm">{t('clients.kra', { value: client.kra_pin })}</div>}
                    {client.id_or_reg_number && <div className="text-xs text-muted-foreground">{t('clients.idReg', { value: client.id_or_reg_number })}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{client.assigned_agent?.full_name ?? '—'}</TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" aria-label={t('clients.editAria')} onClick={(e) => openEdit(client, e)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    {isOwnerOrManager && (
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" aria-label={t('clients.deleteAria')} onClick={(e) => { e.stopPropagation(); setDeleteId(client.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clients.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('clients.deleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteClient.isPending}>
              {deleteClient.isPending ? t('clients.deleting') : t('clients.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
