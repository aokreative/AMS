import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Lead, LeadActivity, PipelineRow } from '@/lib/leads';

const LEAD_SELECT =
  '*, agent:users!leads_assigned_agent_id_fkey(id, full_name), product_line:product_lines(id, name)';

/** Leads the caller can see (agents: their own; owners/managers: all), newest activity first. */
export function useLeads() {
  const { agency, session } = useAuth();
  return useQuery({
    queryKey: ['leads', agency?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_SELECT)
        .order('last_activity_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
    enabled: !!session && !!agency?.id,
  });
}

export function useLeadPipeline() {
  const { agency, session } = useAuth();
  return useQuery({
    queryKey: ['leads', agency?.id, 'pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lead_pipeline').select('stage, count, quoted_total');
      if (error) throw error;
      return (data ?? []) as PipelineRow[];
    },
    enabled: !!session && !!agency?.id,
  });
}

export function useLeadActivities(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['leads', 'activities', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*, author:users(full_name)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeadActivity[];
    },
  });
}

type LeadRpc =
  | 'create_lead'
  | 'update_lead'
  | 'log_lead_contact'
  | 'move_lead'
  | 'mark_lead_lost'
  | 'reopen_lead'
  | 'assign_lead'
  | 'delete_lead'
  | 'convert_lead'
  | 'set_lead_follow_up';

/** Runs one lead RPC and refreshes leads (and policies/clients after a conversion). */
export function useLeadAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rpc, args }: { rpc: LeadRpc; args: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      return data as unknown;
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (v.rpc === 'convert_lead') {
        void qc.invalidateQueries({ queryKey: ['policies'] });
        void qc.invalidateQueries({ queryKey: ['clients'] });
      }
    },
  });
}
