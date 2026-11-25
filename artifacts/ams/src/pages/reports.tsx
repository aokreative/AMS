import { getCurrency } from '@/lib/money';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  BarChart2, 
  TrendingUp, 
  Users, 
  FileText, 
  DollarSign, 
  Eye, 
  Printer, 
  Loader2
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useYtdSummary,
  useMonthlyPremiumVolume,
  usePolicyStatusBreakdown,
  useTopClients,
  useTopInsurers,
  useNewClientsPerMonth,
  useReports
} from '@/hooks/queries';
import { useQueryClient } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ResponsiveContainer,
  Label as RechartsLabel
} from 'recharts';

// Colors mapped to Tailwind theme / brand colors
const COLORS = {
  primary: '#1e3a5f',
  accent: '#0ea5e9',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  purple: '#8b5cf6',
  slate: '#64748b'
};

const STATUS_COLORS: Record<string, string> = {
  active: COLORS.emerald,
  pending: COLORS.amber,
  expired: COLORS.rose,
  cancelled: COLORS.slate
};

export default function Reports() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { session, agency } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries
  const { data: ytdSummary, isLoading: isLoadingYtd } = useYtdSummary();
  const { data: monthlyPremium, isLoading: isLoadingMonthly } = useMonthlyPremiumVolume();
  const { data: policyStatus, isLoading: isLoadingStatus } = usePolicyStatusBreakdown();
  const { data: topClients, isLoading: isLoadingClients } = useTopClients();
  const { data: topInsurers, isLoading: isLoadingInsurers } = useTopInsurers();
  const { data: newClients, isLoading: isLoadingNewClients } = useNewClientsPerMonth();
  const { data: reports, isLoading: isLoadingReports } = useReports();

  // Modals state
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Default to previous month
  const prevDate = new Date();
  prevDate.setMonth(prevDate.getMonth() - 1);
  const [generateMonth, setGenerateMonth] = useState<string>((prevDate.getMonth() + 1).toString());
  const [generateYear, setGenerateYear] = useState<string>(prevDate.getFullYear().toString());

  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  // Formatting compact currency for charts
  const formatCompactKsh = (val: number) => {
    return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(val);
  };

  const handleGenerate = async () => {
    if (!session) return;
    setIsGenerating(true);
    try {
      const { error } = await supabase.rpc('generate_monthly_report', {
        p_month: parseInt(generateMonth),
        p_year: parseInt(generateYear),
      });

      if (error) {
        throw new Error(error.message || t('agency.failedToGenerate'));
      }

      toast({
        title: t('agency.success'),
        description: t('agency.reportGenerated'),
      });
      setIsGenerateOpen(false);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    } catch (error: any) {
      toast({
        title: t('agency.error'),
        description: error.message || t('agency.errorGenerating'),
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleViewReport = (report: any) => {
    setSelectedReport(report);
    setIsViewOpen(true);
  };

  const amount10kLabel = t('agency.seriesAmount10k', { currency: getCurrency() });
  const statusData = (policyStatus || []).map((e: any) => ({
    ...e,
    label: t(`agency.status${String(e.name).charAt(0).toUpperCase()}${String(e.name).slice(1)}`, { defaultValue: e.name }),
  }));

  const topInsurersData = topInsurers?.map(i => ({
    ...i,
    premium10k: i.premium / 10000
  })) || [];

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="sr-only">{t('agency.reportsTitle')}</h1>
          <p className="text-muted-foreground mt-1">{t('agency.reportsSubtitle')}</p>
        </div>
        <Button onClick={() => setIsGenerateOpen(true)} className="gap-2">
          <BarChart2 className="w-4 h-4" />
          {t('agency.generateReport')}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {isLoadingYtd ? (
          Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('agency.kpiActivePolicies')}</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{ytdSummary?.activePolicies || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('agency.kpiPremiumYtd')}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(ytdSummary?.totalPremiumYtd)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('agency.kpiCommissionYtd')}</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(ytdSummary?.commReceivedYtd)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('agency.kpiNewClientsYtd')}</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{ytdSummary?.newClientsYtd || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('agency.kpiCollectionRate')}</CardTitle>
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${
                  ytdSummary && ytdSummary.collectionRate >= 80 ? 'text-emerald-500' :
                  ytdSummary && ytdSummary.collectionRate >= 50 ? 'text-amber-500' :
                  'text-rose-500'
                }`}>
                  {ytdSummary?.collectionRate || 0}%
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Row 2: Monthly Premium + Portfolio Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('agency.chartMonthlyPremium')}</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {isLoadingMonthly ? <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-8 w-32 animate-pulse rounded-md" /></div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyPremium || []} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatCompactKsh} axisLine={false} tickLine={false} />
                  <RechartsTooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    cursor={{fill: '#f1f5f9'}}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar dataKey="premium" name={t('agency.seriesPremium')} fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expected" name={t('agency.seriesExpectedComm')} fill={COLORS.accent} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="received" name={t('agency.seriesReceivedComm')} fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('agency.chartPortfolioMix')}</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {isLoadingStatus ? <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-8 w-32 animate-pulse rounded-md" /></div> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={110}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {(policyStatus || []).map((entry: any) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || COLORS.slate} />
                    ))}
                    <RechartsLabel 
                      value={(policyStatus || []).reduce((acc: number, cur: any) => acc + cur.value, 0)} 
                      position="center" 
                      className="text-3xl font-bold fill-foreground"
                    />
                  </Pie>
                  <RechartsTooltip formatter={(value: number) => [value, t('agency.seriesPolicies')]} />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Top Clients & Top Insurers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('agency.chartTopClients')}</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {isLoadingClients ? <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-8 w-32 animate-pulse rounded-md" /></div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topClients || []} layout="vertical" margin={{ top: 20, right: 30, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={formatCompactKsh} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={100} tickFormatter={(val: string) => val.length > 20 ? val.substring(0, 20) + '...' : val} />
                  <RechartsTooltip formatter={(value: number) => formatCurrency(value)} cursor={{fill: '#f1f5f9'}} />
                  <Bar dataKey="premium" name={t('agency.seriesPremium')} fill={COLORS.primary} radius={[0, 4, 4, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('agency.chartTopInsurers')}</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {isLoadingInsurers ? <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-8 w-32 animate-pulse rounded-md" /></div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topInsurersData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tickFormatter={(val: string) => val.length > 15 ? val.substring(0, 15) + '...' : val} />
                  <YAxis yAxisId="left" orientation="left" axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={formatCompactKsh} axisLine={false} tickLine={false} />
                  <RechartsTooltip 
                    formatter={(value: number, name: string) => name === amount10kLabel ? formatCurrency(value * 10000) : value}
                    cursor={{fill: '#f1f5f9'}}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar yAxisId="left" dataKey="count" name={t('agency.seriesPolicies')} fill={COLORS.accent} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="premium10k" name={amount10kLabel} fill={COLORS.emerald} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: New Clients Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t('agency.chartNewClients')}</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {isLoadingNewClients ? <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-8 w-32 animate-pulse rounded-md" /></div> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={newClients || []} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorClients" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                <RechartsTooltip cursor={{ stroke: COLORS.accent, strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="clients" name={t('agency.seriesNewClients')} stroke={COLORS.accent} strokeWidth={3} fillOpacity={1} fill="url(#colorClients)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Phase 5: Reports Archive */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('agency.archiveTitle')}</CardTitle>
            <CardDescription>{t('agency.archiveDesc')}</CardDescription>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setIsGenerateOpen(true)}>
            <BarChart2 className="w-4 h-4 me-2" /> {t('agency.generateReport')}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('agency.colMonthYear')}</TableHead>
                  <TableHead className="text-end">{t('agency.colPoliciesWritten')}</TableHead>
                  <TableHead className="text-end">{t('agency.colPremium', { currency: getCurrency() })}</TableHead>
                  <TableHead className="text-end">{t('agency.colCommissionsReceived')}</TableHead>
                  <TableHead className="text-end">{t('agency.colCollectionRate')}</TableHead>
                  <TableHead className="text-end">{t('agency.colNewClients')}</TableHead>
                  <TableHead className="text-end">{t('agency.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingReports ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                      {t('agency.loadingArchive')}
                    </TableCell>
                  </TableRow>
                ) : !reports || reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t('agency.noReports')}
                    </TableCell>
                  </TableRow>
                ) : (
                  reports.map((report: any) => {
                    const md = report.metadata || {};
                    const dateObj = new Date(report.year, report.month - 1);
                    const monthName = dateObj.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
                    
                    return (
                      <TableRow key={report.id}>
                        <TableCell className="font-medium">{monthName}</TableCell>
                        <TableCell className="text-end">{md.total_policies_written || 0}</TableCell>
                        <TableCell className="text-end">{formatCurrency(md.total_premium_kes || 0)}</TableCell>
                        <TableCell className="text-end">{formatCurrency(md.commission_received_kes || 0)}</TableCell>
                        <TableCell className="text-end">{md.collection_rate_pct ?? 0}%</TableCell>
                        <TableCell className="text-end">{md.new_clients || 0}</TableCell>
                        <TableCell className="text-end">
                          <Button variant="ghost" size="sm" onClick={() => handleViewReport(report)}>
                            <Eye className="w-4 h-4 me-2" /> {t('agency.view')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Generate Report Dialog */}
      <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agency.generateDialogTitle')}</DialogTitle>
            <DialogDescription>{t('agency.generateDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t('agency.month')}</Label>
              <Select value={generateMonth} onValueChange={setGenerateMonth}>
                <SelectTrigger>
                  <SelectValue placeholder={t('agency.selectMonth')} />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <SelectItem key={m} value={m.toString()}>
                      {new Date(2000, m - 1).toLocaleDateString(locale, { month: 'long' })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('agency.year')}</Label>
              <Input type="number" value={generateYear} onChange={e => setGenerateYear(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
              {t('agency.generate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Report Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-2xl">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print { 
              body > * { display: none; } 
              .print-report { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 2rem; background: white; color: black; } 
              .print-report .border { border-color: #e2e8f0 !important; }
              .print-report .bg-muted { background-color: #f1f5f9 !important; }
            }
          `}} />
          <DialogHeader className="print:hidden">
            <DialogTitle>{t('agency.reportDetails')}</DialogTitle>
          </DialogHeader>
          
          {selectedReport && (
            <div className="print-report space-y-6">
              <div className="border-b pb-4">
                <h2 className="text-2xl font-bold text-foreground">{agency?.name}</h2>
                <p className="text-lg text-muted-foreground mt-1">
                  {t('agency.monthlyReport')} &mdash; {new Date(selectedReport.year, selectedReport.month - 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                </p>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium text-muted-foreground">{t('agency.colPoliciesWritten')}</div>
                  <div className="text-2xl font-bold mt-1">{selectedReport.metadata?.total_policies_written || 0}</div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium text-muted-foreground">{t('agency.statTotalPremium')}</div>
                  <div className="text-2xl font-bold mt-1">{formatCurrency(selectedReport.metadata?.total_premium_kes || 0)}</div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium text-muted-foreground">{t('agency.seriesExpectedComm')}</div>
                  <div className="text-2xl font-bold mt-1">{formatCurrency(selectedReport.metadata?.commission_expected_kes || 0)}</div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium text-muted-foreground">{t('agency.seriesReceivedComm')}</div>
                  <div className="text-2xl font-bold mt-1">{formatCurrency(selectedReport.metadata?.commission_received_kes || 0)}</div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium text-muted-foreground">{t('agency.colCollectionRate')}</div>
                  <div className="text-2xl font-bold mt-1">{selectedReport.metadata?.collection_rate_pct || 0}%</div>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="text-sm font-medium text-muted-foreground">{t('agency.colNewClients')}</div>
                  <div className="text-2xl font-bold mt-1">{selectedReport.metadata?.new_clients || 0}</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground pt-4 border-t">
                {t('agency.generatedOn', { date: formatDate(selectedReport.generated_at) })}
              </div>
            </div>
          )}

          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setIsViewOpen(false)}>{t('common.close')}</Button>
            <Button onClick={() => window.print()} className="gap-2">
              <Printer className="w-4 h-4" /> {t('agency.printSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
