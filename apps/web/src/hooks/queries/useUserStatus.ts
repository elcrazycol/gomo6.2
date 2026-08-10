import { useQuery } from '@tanstack/react-query';
import { api } from '@/integrations/api/compat';

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

      // ttlMs 30s: profiles table defaults to 5min cache, but online status is
      // time-sensitive (refetchInterval below) and must not be served stale.
      const { data, error } = await api
        .from('profiles', { ttlMs: 30 * 1000 })
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

      // Same 30s override as useUserStatus — online state must stay fresh.
      const { data, error } = await api
        .from('profiles', { ttlMs: 30 * 1000 })
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
