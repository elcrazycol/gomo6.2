// Hook for real-time online status updates via WebSocket
import { useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsService } from '@/services/websocket';

interface UserStatus {
  user_id: string;
  is_online: boolean;
  last_seen?: string;
}

interface WsStatusMessage {
  user_id: string;
  last_seen?: string;
}

/**
 * Hook to track online status of multiple users in real-time
 * Subscribes to WebSocket user_online/user_offline events
 */
export function useRealtimeOnlineStatus(userIds: string[]) {
  const [statuses, setStatuses] = useState<Map<string, UserStatus>>(new Map());

  // Memoize the joined string to use as a stable dependency
  const userIdsKey = useMemo(() => userIds.join(','), [userIds]);

  useEffect(() => {
    if (!userIds.length) return;

    // Subscribe to user status events
    const unsubscribeOnline = wsService.on('user_online', (message) => {
      if (message.data) {
        try {
          const data = message.data as WsStatusMessage;

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
          const data = message.data as WsStatusMessage;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdsKey]); // Re-subscribe when user list changes (userIds captured via userIdsKey)

  return statuses;
}

/**
 * Hook to track online status of a single user in real-time
 * Also updates React Query cache for profile-hover queries
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
          const data = message.data as WsStatusMessage;

          if (data.user_id === userId) {
            const newStatus = {
              user_id: data.user_id,
              is_online: true,
              last_seen: new Date().toISOString(),
            };
            setStatus(newStatus);

            // Update React Query cache for profile-hover
            queryClient.setQueryData(['profile-hover', userId], (old: { profile: { is_online?: boolean; last_seen?: string; [key: string]: unknown } } | undefined) => {
              if (!old) return old;
              return {
                ...old,
                profile: {
                  ...old.profile,
                  is_online: true,
                  last_seen: newStatus.last_seen,
                }
              };
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
          const data = message.data as WsStatusMessage;

          if (data.user_id === userId) {
            const newStatus = {
              user_id: data.user_id,
              is_online: false,
              last_seen: data.last_seen || new Date().toISOString(),
            };
            setStatus(newStatus);

            // Update React Query cache for profile-hover
            queryClient.setQueryData(['profile-hover', userId], (old: { profile: { is_online?: boolean; last_seen?: string; [key: string]: unknown } } | undefined) => {
              if (!old) return old;
              return {
                ...old,
                profile: {
                  ...old.profile,
                  is_online: false,
                  last_seen: newStatus.last_seen,
                }
              };
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
  }, [userId, queryClient]);

  return status;
}
