import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { SubscriptionPayment, SubscriptionUsage } from '@/lib/types';

/** Edge Function errors come back as a FunctionsHttpError; pull the JSON {error} out of it. */
async function functionError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    const body = await ctx.json().catch(() => null);
    if (body?.error) return new Error(body.error);
  }
  return error instanceof Error ? error : new Error('Something went wrong. Please try again.');
}

/** Owner only (RLS): the agency's payment history, newest first. */
export function usePayments() {
  const { agency, isOwner } = useAuth();
  return useQuery({
    queryKey: ['subscription-payments', agency?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_payments')
        .select('id, agency_id, tier, months, amount_kes, paystack_reference, channel, status, paid_until_before, paid_until_after, created_at, paid_at')
        .eq('agency_id', agency!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SubscriptionPayment[];
    },
    enabled: !!agency?.id && isOwner,
  });
}

/** Owner only: members, pending invites and active policies counted against the plan. */
export function useSubscriptionUsage() {
  const { agency, isOwner } = useAuth();
  return useQuery({
    queryKey: ['subscription-usage', agency?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('subscription_usage', { p_agency_id: agency!.id });
      if (error) throw error;
      return data as SubscriptionUsage;
    },
    enabled: !!agency?.id && isOwner,
  });
}

/** Dry run: does the agency fit this tier right now? Returns the reason it doesn't, or null. */
export async function tierFitError(agencyId: string, tier: string): Promise<string | null> {
  const { error } = await supabase.rpc('subscription_check_tier', { p_agency_id: agencyId, p_tier: tier });
  return error ? error.message : null;
}

/** Start a Paystack checkout and send the browser there. */
export function useInitializePayment() {
  return useMutation({
    mutationFn: async ({ tier, months }: { tier: string; months: number }) => {
      const { data, error } = await supabase.functions.invoke('paystack-initialize', { body: { tier, months } });
      if (error) throw await functionError(error);
      if (!data?.authorization_url) throw new Error(data?.error ?? 'Could not start the payment.');
      return data as { authorization_url: string; reference: string };
    },
    onSuccess: (d) => {
      window.location.assign(d.authorization_url);
    },
  });
}

/** Confirm a payment on return from Paystack; refreshes the agency on success. */
export function useVerifyPayment() {
  const qc = useQueryClient();
  const { refreshProfile } = useAuth();
  return useMutation({
    mutationFn: async (reference: string) => {
      const { data, error } = await supabase.functions.invoke('paystack-verify', { body: { reference } });
      if (error) throw await functionError(error);
      return data as { status: 'paid' | 'pending' | 'failed' | 'needs_review'; paid_until: string | null; tier: string | null };
    },
    onSuccess: async (d) => {
      if (d.status === 'paid') {
        await refreshProfile();
        void qc.invalidateQueries({ queryKey: ['subscription-payments'] });
        void qc.invalidateQueries({ queryKey: ['subscription-usage'] });
      }
    },
  });
}
