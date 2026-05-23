import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/api/client_simple';

export interface Post {
  id: string;
  thread_id: string;
  user_id: string;
  content: string;
  content_json?: any;
  image_url?: string;
  image_urls?: string[];
  attachments?: any[];
  reply_to?: string;
  is_private?: boolean;
  private_recipient_id?: string;
  created_at: string;
  profiles?: {
    id: string;
    username: string;
    avatar_url?: string;
    is_anonymous?: boolean;
  };
}

/**
 * Hook for fetching posts for a thread with caching
 */
export function usePosts(threadId: string | undefined) {
  return useQuery({
    queryKey: ['posts', threadId],
    queryFn: async () => {
      if (!threadId) return [];

      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles:user_id(*)')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data as Post[]) ?? [];
    },
    enabled: !!threadId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook for creating a post with optimistic updates
 */
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (post: {
      thread_id: string;
      content: string;
      content_json?: any;
      image_urls?: string[];
      attachments?: any[];
      reply_to?: string;
      is_private?: boolean;
      private_recipient_id?: string;
    }) => {
      const response = await fetch('/rpc/v1/create_post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify(post),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }

      const result = await response.json();
      return result.data || result;
    },
    onSuccess: (data, variables) => {
      // Invalidate posts list for this thread
      queryClient.invalidateQueries({ queryKey: ['posts', variables.thread_id] });

      // Invalidate thread to update post count
      queryClient.invalidateQueries({ queryKey: ['thread', variables.thread_id] });
    },
  });
}

/**
 * Hook for deleting a post
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postId, threadId }: { postId: string; threadId: string }) => {
      const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId);

      if (error) throw error;
      return { postId, threadId };
    },
    onSuccess: (data) => {
      // Invalidate posts list for this thread
      queryClient.invalidateQueries({ queryKey: ['posts', data.threadId] });

      // Invalidate thread to update post count
      queryClient.invalidateQueries({ queryKey: ['thread', data.threadId] });
    },
  });
}
