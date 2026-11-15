// Small helpers for the Deno Edge Functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

/** Client that acts as the caller (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

export interface Owner {
  userId: string;
  email: string;
  agencyId: string;
}

/** The caller must be the active Owner of an agency; returns null otherwise. */
export async function requireOwner(req: Request): Promise<Owner | null> {
  const sb = userClient(req);
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return null;
  const { data: me } = await sb
    .from('users')
    .select('id, agency_id, role, email, deactivated_at')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!me || me.role !== 'owner' || me.deactivated_at) return null;
  return { userId: me.id, email: auth.user.email ?? me.email, agencyId: me.agency_id };
}

export async function paystack(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === false) {
    throw new Error(body?.message || `Paystack error ${res.status}`);
  }
  return body;
}
