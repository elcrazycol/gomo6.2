import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/integrations/api/compat';

export interface Profile {
  id: string;
  username: string;
  email?: string;
  domain?: string;
  avatar_url?: string;
  bio?: string;
  bio_json?: unknown;
  garma?: number;
  post_count?: number;
  thread_count?: number;
  is_online?: boolean;
  last_seen?: string;
  created_at: string;
  is_remote?: boolean;
  is_anonymous?: boolean;
}

/**
 * Hook for fetching a single profile with caching
 */
export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await api
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data as Profile;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook for fetching multiple profiles in a batch (optimized)
 */
export function useProfiles(userIds: string[]) {
  const sortedIds = [...userIds].sort().join(',');

  return useQuery({
    queryKey: ['profiles', sortedIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];

      const { data, error } = await api
        .from('profiles')
        .select('*')
        .in('id', userIds);

      if (error) throw error;
      return data as Profile[];
    },
    enabled: userIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook for updating profile with cache invalidation
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: Partial<Profile> }) => {
      const { data, error } = await api
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return data as Profile;
    },
    onSuccess: (data) => {
      // Invalidate this profile's cache
      queryClient.invalidateQueries({ queryKey: ['profile', data.id] });

      // Invalidate any batch queries that might include this profile
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

/**
 * Hook for user achievements with caching
 */
export function useAchievements(userId: string | undefined) {
  return useQuery({
    queryKey: ['achievements', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await api
        .from('user_achievements')
        .select(`
          level,
          is_pinned,
          pinned_order,
          unlocked_at,
          achievements (
            id,
            name,
            description,
            icon,
            category,
            achievement_type
          )
        `)
        .eq('user_id', userId)
        .order('is_pinned', { ascending: false })
        .order('pinned_order', { ascending: true })
        .order('level', { ascending: false })
        .order('unlocked_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for user threads with caching
 */
export function useUserThreads(userId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['user-threads', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await api
        .from('threads')
        .select(`
          id,
          title,
          content,
          image_url,
          image_urls,
          created_at,
          updated_at,
          user_id,
          tags,
          ephemeral_type,
          ephemeral_value,
          auto_delete_at,
          boards (
            slug,
            name
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data;
    },
    enabled: !!userId && (options?.enabled !== false),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}
