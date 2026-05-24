import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/integrations/api/compat';

export interface Thread {
  id: string;
  board_id: string;
  user_id: string;
  title: string;
  content: string;
  content_json?: any;
  image_url?: string;
  image_urls?: string[];
  attachments?: any[];
  post_count: number;
  created_at: string;
  updated_at: string;
  boards?: {
    slug: string;
    name: string;
    is_gomosub: boolean;
    is_rules_board: boolean;
  };
  profiles?: {
    username: string;
    avatar_url?: string;
    is_anonymous?: boolean;
  };
}

/**
 * Hook for fetching a single thread with caching
 */
export function useThread(threadId: string | undefined) {
  return useQuery({
    queryKey: ['thread', threadId],
    queryFn: async () => {
      if (!threadId) return null;

      const { data, error } = await api
        .from('threads')
        .select('*, boards(*), profiles:user_id(*)')
        .eq('id', threadId)
        .single();

      if (error) throw error;
      return data as Thread;
    },
    enabled: !!threadId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for fetching threads for a board with caching
 */
export function useThreads(boardId: string | undefined, options?: { limit?: number; offset?: number }) {
  const { limit = 20, offset = 0 } = options || {};

  return useQuery({
    queryKey: ['threads', boardId, limit, offset],
    queryFn: async () => {
      if (!boardId) return [];

      const { data, error } = await api
        .from('threads')
        .select('*, boards(*), profiles:user_id(*)')
        .eq('board_id', boardId)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data as Thread[];
    },
    enabled: !!boardId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook for creating a thread with optimistic updates
 */
export function useCreateThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (thread: { board_id: string; title: string; content: string; content_json?: any; image_urls?: string[]; attachments?: any[] }) => {
      const { data, error } = await api
        .from('threads')
        .insert(thread)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Invalidate threads list for this board
      queryClient.invalidateQueries({ queryKey: ['threads', data.board_id] });
    },
  });
}

/**
 * Hook for thread subscription status
 */
export function useThreadSubscription(threadId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['thread-subscription', threadId, userId],
    queryFn: async () => {
      if (!threadId || !userId) return false;

      const { data } = await api
        .from('thread_subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('thread_id', threadId)
        .maybeSingle();

      return !!data;
    },
    enabled: !!threadId && !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
