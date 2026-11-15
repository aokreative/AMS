// Paystack → us. Signature-checked; applies charge.success. Always 200 once verified.
import { verifySignature } from '../_shared/billing.ts';
import { json, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const raw = await req.text();
  const ok = await verifySignature(raw, req.headers.get('x-paystack-signature'), Deno.env.get('PAYSTACK_SECRET_KEY') ?? '');
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ received: true });
  }

  if (event?.event === 'charge.success' && event?.data?.reference) {
    const d = event.data;
    // Guard against a tampered or mismatched amount: it must match what we asked for.
    const svc = serviceClient();
    const { data: pay } = await svc
      .from('subscription_payments')
      .select('amount_kes')
      .eq('paystack_reference', d.reference)
      .maybeSingle();
    if (pay && Number(d.amount) === pay.amount_kes * 100 && d.currency === 'KES') {
      const { error } = await svc.rpc('apply_subscription_payment', {
        p_reference: d.reference,
        p_channel: d.channel ?? null,
        p_raw: d,
      });
      if (error) {
        console.error('apply_subscription_payment failed', d.reference, error.message);
        return json({ error: 'retry' }, 500); // Paystack retries non-2xx
      }
    } else {
      console.warn('charge.success ignored', d.reference, d.amount, d.currency);
    }
  }
  return json({ received: true });
});
