import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/api/client_simple';

export interface UserStatus {
  user_id: string;
  is_online: boolean;
  last_seen?: string;
}

/**
 * Hook for fetching user online status with caching
 */
export function useUserStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-status', userId],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('id, is_online, last_seen')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return {
        user_id: data.id,
        is_online: data.is_online || false,
        last_seen: data.last_seen,
      } as UserStatus;
    },
    enabled: !!userId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Hook for fetching multiple user statuses in batch
 */
export function useBulkUserStatus(userIds: string[]) {
  const sortedIds = [...userIds].sort().join(',');

  return useQuery({
    queryKey: ['user-status-bulk', sortedIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select('id, is_online, last_seen')
        .in('id', userIds);

      if (error) throw error;
      return data.map(d => ({
        user_id: d.id,
        is_online: d.is_online || false,
        last_seen: d.last_seen,
      })) as UserStatus[];
    },
    enabled: userIds.length > 0,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}
