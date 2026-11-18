import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AdminAgencyRow, AdminDetail, AdminOverview, AdminRpc } from '@/lib/admin';

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_overview');
      if (error) throw error;
      return data as AdminOverview;
    },
  });
}

export function useAdminAgencies() {
  return useQuery({
    queryKey: ['admin', 'agencies'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_agencies');
      if (error) throw error;
      return (data ?? []) as AdminAgencyRow[];
    },
  });
}

export function useAdminAgencyDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_agency_detail', { p_agency_id: id });
      if (error) throw error;
      return data as AdminDetail;
    },
  });
}

/** Runs one admin_* action (always with p_agency_id and p_note) and refreshes the admin views. */
export function useAdminAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rpc, args }: { rpc: AdminRpc; args: Record<string, unknown> }) => {
      const { error } = await supabase.rpc(rpc, args);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}
