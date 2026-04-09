import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsService, WebSocketMessage } from '@/services/websocket';

/**
 * Hook for handling WebSocket realtime updates with React Query cache invalidation
 * This replaces direct state manipulation with cache invalidation for better consistency
 */
export function useWebSocketSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Handle new post events
    const unsubscribeNewPost = wsService.on('new_post', (message: WebSocketMessage) => {
      try {
        const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

        if (data.thread_id) {
          // Invalidate posts cache for this thread
          queryClient.invalidateQueries({ queryKey: ['posts', data.thread_id] });

          // Invalidate thread cache to update post count
          queryClient.invalidateQueries({ queryKey: ['thread', data.thread_id] });
        }
      } catch (e) {
        console.error('[WebSocket] Error handling new_post:', e);
      }
    });

    // Handle new thread events
    const unsubscribeNewThread = wsService.on('new_thread', (message: WebSocketMessage) => {
      try {
        const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

        if (data.board_id) {
          // Invalidate threads cache for this board
          queryClient.invalidateQueries({ queryKey: ['threads', data.board_id] });
        }
      } catch (e) {
        console.error('[WebSocket] Error handling new_thread:', e);
      }
    });

    // Handle user status updates
    const unsubscribeUserOnline = wsService.on('user_online', (message: WebSocketMessage) => {
      try {
        const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

        if (data.user_id) {
          // Invalidate user status cache
          queryClient.invalidateQueries({ queryKey: ['user-status', data.user_id] });
          queryClient.invalidateQueries({ queryKey: ['profile', data.user_id] });
        }
      } catch (e) {
        console.error('[WebSocket] Error handling user_online:', e);
      }
    });

    const unsubscribeUserOffline = wsService.on('user_offline', (message: WebSocketMessage) => {
      try {
        const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;

        if (data.user_id) {
          // Invalidate user status cache
          queryClient.invalidateQueries({ queryKey: ['user-status', data.user_id] });
          queryClient.invalidateQueries({ queryKey: ['profile', data.user_id] });
        }
      } catch (e) {
        console.error('[WebSocket] Error handling user_offline:', e);
      }
    });

    // Cleanup subscriptions
    return () => {
      unsubscribeNewPost();
      unsubscribeNewThread();
      unsubscribeUserOnline();
      unsubscribeUserOffline();
    };
  }, [queryClient]);
}
