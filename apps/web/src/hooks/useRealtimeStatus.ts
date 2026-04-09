// Hook for real-time online status updates via WebSocket
import { useEffect, useState } from 'react';
import { wsService } from '@/services/websocket';
import { useQueryClient } from '@tanstack/react-query';

interface UserStatus {
  user_id: string;
  is_online: boolean;
  last_seen?: string;
}

/**
 * Hook to track online status of multiple users in real-time
 * Subscribes to WebSocket user_online/user_offline events
 */
export function useRealtimeOnlineStatus(userIds: string[]) {
  const [statuses, setStatuses] = useState<Map<string, UserStatus>>(new Map());

  useEffect(() => {
    if (!userIds.length) return;

    // Subscribe to user status events
    const unsubscribeOnline = wsService.on('user_online', (message) => {
      if (message.data) {
        try {
          const data = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;

          if (data.user_id && userIds.includes(data.user_id)) {
            setStatuses(prev => {
              const next = new Map(prev);
              next.set(data.user_id, {
                user_id: data.user_id,
                is_online: true,
                last_seen: new Date().toISOString(),
              });
              return next;
            });
          }
        } catch (e) {
          console.error('Error parsing user_online event:', e);
        }
      }
    });

    const unsubscribeOffline = wsService.on('user_offline', (message) => {
      if (message.data) {
        try {
          const data = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;

          if (data.user_id && userIds.includes(data.user_id)) {
            setStatuses(prev => {
              const next = new Map(prev);
              next.set(data.user_id, {
                user_id: data.user_id,
                is_online: false,
                last_seen: new Date().toISOString(),
              });
              return next;
            });
          }
        } catch (e) {
          console.error('Error parsing user_offline event:', e);
        }
      }
    });

    return () => {
      unsubscribeOnline();
      unsubscribeOffline();
    };
  }, [userIds.join(',')]); // Re-subscribe when user list changes

  return statuses;
}

/**
 * Hook to track online status of a single user in real-time
 */
export function useUserRealtimeStatus(userId: string | undefined) {
  const [status, setStatus] = useState<UserStatus | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // Subscribe to user status events
    const unsubscribeOnline = wsService.on('user_online', (message) => {
      if (message.data) {
        try {
          const data = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;

          if (data.user_id === userId) {
            setStatus({
              user_id: data.user_id,
              is_online: true,
              last_seen: new Date().toISOString(),
            });

            // Invalidate profile cache to force refetch
            queryClient.invalidateQueries({ queryKey: ['profile-hover', userId] });
          }
        } catch (e) {
          console.error('Error parsing user_online event:', e);
        }
      }
    });

    const unsubscribeOffline = wsService.on('user_offline', (message) => {
      if (message.data) {
        try {
          const data = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;

          if (data.user_id === userId) {
            setStatus({
              user_id: data.user_id,
              is_online: false,
              last_seen: new Date().toISOString(),
            });

            // Invalidate profile cache to force refetch
            queryClient.invalidateQueries({ queryKey: ['profile-hover', userId] });
          }
        } catch (e) {
          console.error('Error parsing user_offline event:', e);
        }
      }
    });

    return () => {
      unsubscribeOnline();
      unsubscribeOffline();
    };
  }, [userId]);

  return status;
}
