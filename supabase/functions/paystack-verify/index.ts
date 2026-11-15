// POST {reference} with the Owner's JWT → {status, paid_until, tier}
// Called by the return page so the Owner sees the result even if the webhook is late.
import { cors, json, paystack, requireOwner, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const owner = await requireOwner(req);
  if (!owner) return json({ error: 'Only the owner can do that' }, 403);

  const reference = String((await req.json().catch(() => ({})))?.reference ?? '');
  if (!reference) return json({ error: 'Missing reference' }, 400);

  const svc = serviceClient();
  const { data: pay } = await svc
    .from('subscription_payments')
    .select('id, agency_id, amount_kes, status')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (!pay || pay.agency_id !== owner.agencyId) return json({ error: 'Payment not found' }, 404);

  if (pay.status !== 'paid') {
    try {
      const res = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
      const d = res.data;
      if (d?.status === 'success' && Number(d.amount) === pay.amount_kes * 100 && d.currency === 'KES') {
        await svc.rpc('apply_subscription_payment', { p_reference: reference, p_channel: d.channel ?? null, p_raw: d });
      } else if (d?.status === 'failed' || d?.status === 'abandoned') {
        await svc.from('subscription_payments').update({ status: 'failed' }).eq('id', pay.id).eq('status', 'pending');
      }
    } catch (e) {
      console.warn('verify failed', reference, (e as Error).message);
    }
  }

  const [{ data: after }, { data: agency }] = await Promise.all([
    svc.from('subscription_payments').select('status').eq('id', pay.id).single(),
    svc.from('agencies').select('paid_until, subscription_tier').eq('id', owner.agencyId).single(),
  ]);
  return json({ status: after?.status ?? 'pending', paid_until: agency?.paid_until ?? null, tier: agency?.subscription_tier ?? null });
});
