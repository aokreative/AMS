import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertCircle, Loader2, LogOut, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAction, useAdminAgencies, useAdminAgencyDetail, useAdminOverview } from '@/hooks/admin';
import { ADMIN_STATUSES, matchesSearch, type AdminAgencyRow, type AdminRpc, type AdminStatus } from '@/lib/admin';
import { formatKes, tierName, TIERS, todayNairobi } from '@/lib/subscription';
import { BrandMark } from '@/components/BrandLockup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<AdminStatus, string> = {
  active: 'Active',
  grace: 'Grace',
  unpaid: 'Unpaid',
  comped: 'Free',
  suspended: 'Suspended',
};

const STATUS_STYLE: Record<AdminStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  grace: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  unpaid: 'bg-muted text-muted-foreground',
  comped: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100',
  suspended: 'bg-destructive/15 text-destructive',
};

const ACTION_LABEL: Record<string, string> = {
  suspend: 'Suspended',
  reactivate: 'Reactivated',
  set_custom_price: 'Custom price',
  set_comp: 'Free time',
  set_paid_until: 'Paid-until',
  set_tier: 'Plan',
};

function d(v: string | null | undefined, withTime = false) {
  if (!v) return '—';
  return format(parseISO(v), withTime ? 'd MMM yyyy, HH:mm' : 'd MMM yyyy');
}

function StatusBadge({ status }: { status: AdminStatus }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

/** Superadmin: every agency, its status and money, and the actions on it. */
export default function Admin() {
  const { session, signOut } = useAuth();
  const overview = useAdminOverview();
  const agencies = useAdminAgencies();
  const [filter, setFilter] = useState<AdminStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () => (agencies.data ?? []).filter((r) => (filter === 'all' || r.status === filter) && matchesSearch(r, q)),
    [agencies.data, filter, q],
  );
  const open = agencies.data?.find((r) => r.id === openId) ?? null;
  const counts = overview.data?.counts;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <BrandMark className="h-8 w-8" />
          <div>
            <div className="flex items-center gap-1.5 font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" /> Superadmin
            </div>
            <div className="text-xs text-muted-foreground">{session?.email}</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut className="me-1 h-4 w-4" /> Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Agencies</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{counts?.total ?? '—'}</div>
              <div className="text-xs text-muted-foreground">
                {counts ? `${counts.active} active · ${counts.grace} grace · ${counts.comped} free` : ''}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Unpaid / suspended</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{counts ? `${counts.unpaid} / ${counts.suspended}` : '—'}</div>
              <div className="text-xs text-muted-foreground">Can't use the app</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Expected monthly revenue</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.data ? formatKes(overview.data.expected_mrr_kes) : '—'}</div>
              <div className="text-xs text-muted-foreground">Active and grace agencies, at their price</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Paid this month</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.data ? formatKes(overview.data.revenue_this_month_kes) : '—'}</div>
              <div className="text-xs text-muted-foreground">Paystack payments received</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(['all', ...ADMIN_STATUSES] as const).map((s) => (
              <Button key={s} size="sm" variant={filter === s ? 'default' : 'outline'} onClick={() => setFilter(s)}>
                {s === 'all' ? 'All' : STATUS_LABEL[s]}
                {counts && <span className="ms-1.5 text-xs opacity-70">{s === 'all' ? counts.total : counts[s]}</span>}
              </Button>
            ))}
          </div>
          <div className="relative md:w-72">
            <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="ps-8" placeholder="Agency, owner name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {agencies.error && (
          <p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{(agencies.error as Error).message}</p>
        )}

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-end">Price / month</TableHead>
                <TableHead>Paid until</TableHead>
                <TableHead className="text-end">Members</TableHead>
                <TableHead className="text-end">Policies</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Last payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agencies.isLoading && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              )}
              {!agencies.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No agencies match.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell>{tierName(r.tier)}</TableCell>
                  <TableCell className="text-end whitespace-nowrap">
                    {formatKes(r.price_kes)}
                    {r.custom_price_kes != null && <Badge variant="secondary" className="ms-1.5">custom</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{d(r.paid_until)}</TableCell>
                  <TableCell className="text-end">{r.members}</TableCell>
                  <TableCell className="text-end">{r.active_policies}</TableCell>
                  <TableCell className="max-w-48 truncate">{r.owners[0]?.full_name ?? '—'}{r.owners.length > 1 && ` +${r.owners.length - 1}`}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.last_paid_at ? `${formatKes(r.last_paid_kes ?? 0)} · ${d(r.last_paid_at)}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </main>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {open && <AgencyPanel row={open} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

type ActionKind = 'suspend' | 'reactivate' | 'price' | 'comp' | 'paid_until' | 'tier';

function AgencyPanel({ row }: { row: AdminAgencyRow }) {
  const detail = useAdminAgencyDetail(row.id);
  const act = useAdminAction();
  const today = todayNairobi();
  const [kind, setKind] = useState<ActionKind>(row.status === 'suspended' ? 'reactivate' : 'paid_until');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const facts: [string, React.ReactNode][] = [
    ['Status', <StatusBadge key="s" status={row.status} />],
    ['Plan', tierName(row.tier)],
    ['Price / month', <>{formatKes(row.price_kes)}{row.custom_price_kes != null && ' (custom)'}</>],
    ['Paid until', d(row.paid_until)],
    ['Free until', d(row.complimentary_until)],
    ['Members / active policies', `${row.members} / ${row.active_policies}`],
    ['Working currency', row.currency],
    ['Created', d(row.created_at)],
  ];
  if (row.suspended_at) facts.splice(1, 0, ['Suspended', `${d(row.suspended_at, true)} — ${row.suspended_reason ?? ''}`]);

  const submit = () => {
    setDone(null);
    let rpc: AdminRpc;
    const args: Record<string, unknown> = { p_agency_id: row.id, p_note: note };
    switch (kind) {
      case 'suspend': rpc = 'admin_suspend'; break;
      case 'reactivate': rpc = 'admin_reactivate'; break;
      case 'price': rpc = 'admin_set_custom_price'; args.p_price_kes = value.trim() === '' ? null : Math.round(Number(value)); break;
      case 'comp': rpc = 'admin_set_comp'; args.p_until = value || null; break;
      case 'paid_until': rpc = 'admin_set_paid_until'; args.p_until = value || null; break;
      case 'tier': rpc = 'admin_set_tier'; args.p_tier = value; break;
    }
    act.mutate({ rpc, args }, {
      onSuccess: () => {
        setDone('Saved.');
        setNote('');
        setValue('');
      },
    });
  };

  const input = (() => {
    switch (kind) {
      case 'price':
        return (
          <div className="space-y-1.5">
            <Label htmlFor="adm-price">Monthly price for the {tierName(row.tier)} plan (KES). Leave empty to go back to the standard price.</Label>
            <Input id="adm-price" type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)} placeholder={String(TIERS.find((x) => x.key === row.tier)?.price_kes ?? '')} />
          </div>
        );
      case 'comp':
        return (
          <div className="space-y-1.5">
            <Label htmlFor="adm-comp">Free (no payment, no limits) until. Leave empty to remove free time.</Label>
            <Input id="adm-comp" type="date" min={today} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        );
      case 'paid_until':
        return (
          <div className="space-y-1.5">
            <Label htmlFor="adm-paid">Paid until (e.g. after a cash or bank payment)</Label>
            <Input id="adm-paid" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        );
      case 'tier':
        return (
          <div className="space-y-1.5">
            <Label>Plan (no payment taken)</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger><SelectValue placeholder="Pick a plan" /></SelectTrigger>
              <SelectContent>
                {TIERS.map((x) => <SelectItem key={x.key} value={x.key}>{x.name} · {formatKes(x.price_kes)}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">If the agency already has more members or policies than the plan allows, it keeps them but can't add more.</p>
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle>{row.name}</SheetTitle>
        <SheetDescription>
          {row.owners.map((o) => [o.full_name, o.email, o.phone].filter(Boolean).join(' · ')).join(' | ') || 'No active Owner'}
        </SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">Change</h3>
        <Select value={kind} onValueChange={(v) => { setKind(v as ActionKind); setValue(''); setDone(null); act.reset(); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {row.suspended_at
              ? <SelectItem value="reactivate">Reactivate</SelectItem>
              : <SelectItem value="suspend">Suspend</SelectItem>}
            <SelectItem value="price">Custom monthly price</SelectItem>
            <SelectItem value="comp">Free time</SelectItem>
            <SelectItem value="paid_until">Set paid-until</SelectItem>
            <SelectItem value="tier">Change plan</SelectItem>
          </SelectContent>
        </Select>
        {input}
        {kind === 'suspend' && (
          <p className="text-sm text-muted-foreground">Everyone in this agency will see "This account is suspended" with your note as the reason, and nothing can be changed or paid until you reactivate it.</p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="adm-note">{kind === 'suspend' ? 'Reason (shown to the agency)' : 'Note (for the log)'}</Label>
          <Textarea id="adm-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {act.error && (
          <p className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{(act.error as Error).message}</p>
        )}
        {done && <p className="text-sm text-emerald-700 dark:text-emerald-300">{done}</p>}
        <Button onClick={submit} disabled={act.isPending} variant={kind === 'suspend' ? 'destructive' : 'default'}>
          {act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {kind === 'suspend' ? 'Suspend agency' : kind === 'reactivate' ? 'Reactivate agency' : 'Save'}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Payments</h3>
        {detail.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (detail.data?.payments.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {detail.data!.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{d(p.paid_at ?? p.created_at)} · {tierName(p.tier)} · {p.months === 0 ? 'upgrade' : `${p.months} mo`}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{formatKes(p.amount_kes)}</span>
                  <Badge variant={p.status === 'paid' ? 'default' : 'secondary'}>{p.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Superadmin log</h3>
        {(detail.data?.actions.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.data!.actions.map((a, i) => (
              <li key={i} className="rounded-lg border px-3 py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="text-xs text-muted-foreground">{d(a.created_at, true)}</span>
                </div>
                <div className="text-muted-foreground">{a.note}</div>
                <div className="text-xs text-muted-foreground">by {a.admin_email ?? 'unknown'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
