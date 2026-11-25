import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProductLines, useCreateProductLine, useUpdateProductLine, useDeleteProductLine } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Edit, Trash2, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { exportToCsv } from '@/lib/csv-export';

const makeProductLineSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(2, t('agency.nameRequired')),
  description: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});

type ProductLineFormValues = z.infer<ReturnType<typeof makeProductLineSchema>>;

export default function ProductLines() {
  const { t } = useTranslation();
  const productLineSchema = useMemo(() => makeProductLineSchema(t), [t]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<any | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const { data: productLines, isLoading } = useProductLines();
  const createLine = useCreateProductLine();
  const updateLine = useUpdateProductLine();
  const deleteLine = useDeleteProductLine();
  const { toast } = useToast();

  const form = useForm<ProductLineFormValues>({
    resolver: zodResolver(productLineSchema),
    defaultValues: {
      name: '',
      description: '',
      is_active: true,
    },
  });

  const filteredLines = productLines?.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const onSubmit = (values: ProductLineFormValues) => {
    if (editingLine) {
      updateLine.mutate({ id: editingLine.id, ...values }, {
        onSuccess: () => {
          toast({ title: t('agency.productLineUpdated') });
          setIsAddOpen(false);
          setEditingLine(null);
          form.reset();
        }
      });
    } else {
      createLine.mutate(values, {
        onSuccess: () => {
          toast({ title: t('agency.productLineAdded') });
          setIsAddOpen(false);
          form.reset();
        }
      });
    }
  };

  const openEdit = (line: any) => {
    setEditingLine(line);
    form.reset({
      name: line.name,
      description: line.description || '',
      is_active: line.is_active,
    });
    setIsAddOpen(true);
  };

  const toggleActive = (line: any, checked: boolean) => {
    updateLine.mutate({ id: line.id, is_active: checked }, {
      onSuccess: () => toast({ title: checked ? t('agency.productLineActivated') : t('agency.productLineDeactivated') })
    });
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteLine.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: t('agency.productLineDeleted') });
        setDeleteId(null);
      },
      onError: (err) => {
        toast({ title: t('agency.errorDeletingLine'), description: err.message, variant: 'destructive' });
      }
    });
  };

  const handleExportCsv = () => {
    if (!productLines) return;
    const exportData = productLines.map(p => ({
      name: p.name,
      description: p.description || '',
      is_active: p.is_active
    }));
    exportToCsv('product-lines', exportData);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="sr-only">{t('agency.productLinesTitle')}</h1>
          <p className="text-muted-foreground">{t('agency.productLinesSubtitle')}</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            setEditingLine(null);
            form.reset({ name: '', description: '', is_active: true });
          }
        }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 me-2" /> {t('agency.addProductLine')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingLine ? t('agency.editProductLine') : t('agency.addNewProductLine')}</DialogTitle>
              <DialogDescription>{t('agency.productLineDialogDesc')}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agency.categoryName')}</FormLabel>
                      <FormControl><Input placeholder={t('agency.categoryPlaceholder')} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('agency.descriptionOptional')}</FormLabel>
                      <FormControl><Textarea {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="is_active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>{t('agency.activeStatus')}</FormLabel>
                        <p className="text-[0.8rem] text-muted-foreground">{t('agency.activeLinesHelp')}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createLine.isPending || updateLine.isPending}>
                  {editingLine ? t('agency.saveChanges') : t('agency.addProductLine')}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('agency.searchProductLines')}
            className="ps-9 bg-card"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={handleExportCsv}>
          <Download className="w-4 h-4 me-2" /> {t('agency.exportCsv')}
        </Button>
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('agency.colName')}</TableHead>
              <TableHead>{t('agency.colDescription')}</TableHead>
              <TableHead>{t('agency.colStatus')}</TableHead>
              <TableHead className="text-end">{t('agency.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">{t('common.loading')}</TableCell></TableRow>
            ) : filteredLines?.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t('agency.noProductLines')}</TableCell></TableRow>
            ) : (
              filteredLines?.map((line) => (
                <TableRow key={line.id} className={!line.is_active ? "opacity-60 bg-muted/30" : ""}>
                  <TableCell className="font-medium">{line.name}</TableCell>
                  <TableCell className="text-muted-foreground">{line.description || '-'}</TableCell>
                  <TableCell>
                    {line.is_active ? (
                      <Badge variant="success">{t('agency.active')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('agency.inactive')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" aria-label={t('agency.edit')} onClick={() => openEdit(line)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10 ms-1" aria-label={t('agency.delete')} onClick={() => setDeleteId(line.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Switch 
                      className="ms-2" 
                      aria-label={t('agency.activeStatus')}
                      checked={line.is_active} 
                      onCheckedChange={(c) => toggleActive(line, c)} 
                    />
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
            <AlertDialogTitle>{t('agency.deleteLineTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('agency.deleteLineDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteLine.isPending}>
              {deleteLine.isPending ? t('agency.deleting') : t('agency.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
