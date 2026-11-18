// POST {tier, months} with the Owner's JWT → {authorization_url, reference}
import { paymentAmountKes, todayNairobi, withCustomPrice, type Tier } from '../_shared/billing.ts';
import { cors, json, paystack, requireOwner, serviceClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const owner = await requireOwner(req);
  if (!owner) return json({ error: 'Only the owner can do that' }, 403);

  let tier = '';
  let months = NaN;
  try {
    const body = await req.json();
    tier = String(body?.tier ?? '');
    months = Number(body?.months);
  } catch {
    return json({ error: 'Pick a plan' }, 400);
  }

  const svc = serviceClient();
  const [{ data: tiers }, { data: agency }] = await Promise.all([
    svc.from('subscription_tiers').select('*').order('sort_order'),
    svc.from('agencies').select('subscription_tier, paid_until, custom_price_kes, suspended_at, is_demo').eq('id', owner.agencyId).single(),
  ]);
  if (!tiers || !agency) return json({ error: 'Could not load your plan. Try again.' }, 500);
  if (agency.suspended_at) return json({ error: 'This account is suspended' }, 403);
  if (agency.is_demo) return json({ error: 'Payments are off in the demo' }, 403);

  let amount;
  try {
    amount = paymentAmountKes(withCustomPrice(tiers as Tier[], agency.subscription_tier, agency.custom_price_kes), agency.subscription_tier, tier, months, agency.paid_until, todayNairobi());
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // The agency must already fit the plan it is paying for.
  const { error: fitError } = await svc.rpc('subscription_check_tier', { p_agency_id: owner.agencyId, p_tier: tier });
  if (fitError) return json({ error: fitError.message }, 400);

  const { data: reference, error: payError } = await svc.rpc('create_subscription_payment', {
    p_agency_id: owner.agencyId,
    p_tier: tier,
    p_months: months,
    p_amount_kes: amount.total,
  });
  if (payError || !reference) return json({ error: payError?.message ?? 'Could not start the payment.' }, 500);

  const appUrl = Deno.env.get('APP_URL') ?? 'https://insurance-management-system-ams.vercel.app';
  try {
    const res = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: owner.email,
        amount: amount.total * 100,
        currency: 'KES',
        reference,
        channels: ['mobile_money', 'card'],
        callback_url: `${appUrl}/billing/return`,
        metadata: { agency_id: owner.agencyId, tier, months },
      }),
    });
    return json({ authorization_url: res.data.authorization_url, reference });
  } catch (e) {
    await svc.from('subscription_payments').update({ status: 'failed' }).eq('id', reference);
    return json({ error: `Paystack: ${(e as Error).message}` }, 502);
  }
});
