// Daily (pg_cron, 06:00 Nairobi): email Owners 7 days and 1 day before expiry,
// and when grace ends. Requires the service-role key as bearer.
import { todayNairobi } from '../_shared/billing.ts';
import { json, serviceClient } from '../_shared/http.ts';

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!key || req.headers.get('Authorization') !== `Bearer ${key}`) return json({ error: 'Unauthorized' }, 401);

  const from = Deno.env.get('REMINDER_FROM');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!from || !resendKey) return json({ error: 'REMINDER_FROM / RESEND_API_KEY not set' }, 500);
  const appUrl = Deno.env.get('APP_URL') ?? 'https://insurance-management-system-ams.vercel.app';

  const today = todayNairobi();
  const plan: Record<string, string> = {
    [addDays(today, 7)]: 'Your AMS subscription expires in 7 days',
    [addDays(today, 1)]: 'Your AMS subscription expires tomorrow',
    [addDays(today, -4)]: 'Your AMS agency is now read-only',
  };

  const svc = serviceClient();
  const { data: agencies, error } = await svc
    .from('agencies')
    .select('id, name, paid_until, complimentary_until')
    .in('paid_until', Object.keys(plan));
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const a of agencies ?? []) {
    if (a.complimentary_until && a.complimentary_until >= today) continue;
    const { data: owners } = await svc
      .from('users')
      .select('email, full_name')
      .eq('agency_id', a.id)
      .eq('role', 'owner')
      .is('deactivated_at', null);

    const subject = plan[a.paid_until];
    for (const owner of owners ?? []) {
    if (!owner.email) continue;
    const text =
      `Hi ${owner.full_name ?? ''},\n\n` +
      (subject.includes('read-only')
        ? `${a.name}'s subscription has lapsed, so the agency is now read-only. Everyone can still sign in and see their data, but nothing can be added or changed until you pay.\n\n`
        : `${a.name}'s subscription is paid until ${a.paid_until}. Renew to keep working without interruption.\n\n`) +
      `Pay with M-Pesa or card: ${appUrl}/settings/billing\n\n— AMS`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: owner.email, subject, text }),
    });
    if (res.ok) sent++;
    else console.error('reminder failed', a.id, res.status, await res.text());
    }
  }
  return json({ sent });
});
