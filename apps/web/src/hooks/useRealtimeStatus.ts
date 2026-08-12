// Hook for real-time online status updates via WebSocket presence rooms.
import { useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsService, type WebSocketMessage } from "@/services/websocket";
import { presenceDataFromMessage } from "@/utils/presence";

export interface UserStatus {
  user_id: string;
  is_online: boolean;
  last_seen?: string;
}

// Live presence subscriptions are capped: every extra room costs the backend
// a snapshot (with a privacy DB read) at subscribe time, and a page can hold
// dozens of authors/friends at once. Consumers beyond the cap fall back to
// their REST-loaded values (profiles table / status endpoints).
const MAX_PRESENCE_ROOMS = 30;

const presenceRoom = (userId: string): string => `presence_${userId}`;

/**
 * Hook to track the online status of a single user in real time.
 *
 * Subscribes to the target's presence_<userID> room: the backend immediately
 * replies with a presence_snapshot (current state incl. last_seen), then
 * sends user_online / user_offline deltas while the viewer stays subscribed.
 * The room is reference-counted (subscribeShared), so multiple components
 * tracking the same user share one subscription safely.
 *
 * Offline deltas keep the last known last_seen instead of stamping "now":
 * the snapshot already carries the real last activity from the Redis
 * presence store, and the REST-loaded value is equally accurate.
 *
 * When `enabled` is false the hook performs no subscription and returns null
 * (used by components that receive live status via a bulk hook instead).
 */
export function useUserRealtimeStatus(userId: string | undefined, enabled = true) {
  const [status, setStatus] = useState<UserStatus | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !enabled) return;
    const room = presenceRoom(userId);
    wsService.subscribeShared(room);

    // Latest known state, read by the offline handler to preserve last_seen.
    let current: UserStatus | null = null;

    const apply = (next: UserStatus) => {
      current = next;
      setStatus(next);
      // Update React Query cache for profile-hover
      queryClient.setQueryData(["profile-hover", userId], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const profile = (old as { profile?: Record<string, unknown> }).profile;
        if (!profile) return old;
        return {
          ...old,
          profile: {
            ...profile,
            is_online: next.is_online,
            last_seen: next.last_seen,
          },
        };
      });
    };

    const onSnapshot = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || data.user_id !== userId) return;
      apply({ user_id: userId, is_online: data.is_online ?? false, last_seen: data.last_seen });
    };

    const onOnline = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || data.user_id !== userId) return;
      apply({
        user_id: userId,
        is_online: true,
        last_seen: data.last_seen ?? current?.last_seen ?? new Date().toISOString(),
      });
    };

    const onOffline = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || data.user_id !== userId) return;
      // Preserve the real last activity instead of the delta's arrival time.
      apply({ user_id: userId, is_online: false, last_seen: data.last_seen ?? current?.last_seen });
    };

    const unsubs = [
      wsService.on("presence_snapshot", onSnapshot),
      wsService.on("user_online", onOnline),
      wsService.on("user_offline", onOffline),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
      wsService.unsubscribeShared(room);
    };
  }, [userId, enabled, queryClient]);

  return status;
}

/**
 * Hook to track the online status of many users in real time via their
 * presence rooms. The number of live subscriptions is capped (see
 * MAX_PRESENCE_ROOMS) — the rest keep their REST-loaded values. Returns a Map
 * keyed by user id.
 */
export function useRealtimeOnlineStatus(userIds: string[]) {
  const [statuses, setStatuses] = useState<Map<string, UserStatus>>(new Map());

  // Memoize the joined string as a stable dependency and to dedupe.
  const userIdsKey = useMemo(() => [...new Set(userIds)].join(","), [userIds]);
  const subscribedIds = useMemo(
    () => (userIdsKey ? userIdsKey.split(",").filter(Boolean).slice(0, MAX_PRESENCE_ROOMS) : []),
    [userIdsKey],
  );

  useEffect(() => {
    if (subscribedIds.length === 0) return;
    const rooms = subscribedIds.map(presenceRoom);
    for (const room of rooms) wsService.subscribeShared(room);

    const update = (next: UserStatus) => {
      setStatuses((prev) => {
        const nextMap = new Map(prev);
        nextMap.set(next.user_id, next);
        return nextMap;
      });
    };

    const onSnapshot = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || !data.user_id || !subscribedIds.includes(data.user_id)) return;
      update({ user_id: data.user_id, is_online: data.is_online ?? false, last_seen: data.last_seen });
    };

    const onOnline = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || !data.user_id || !subscribedIds.includes(data.user_id)) return;
      update({
        user_id: data.user_id,
        is_online: true,
        last_seen: data.last_seen ?? new Date().toISOString(),
      });
    };

    const onOffline = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || !data.user_id || !subscribedIds.includes(data.user_id)) return;
      // Keep the last known last_seen (from the snapshot / REST) — it is the
      // real last activity, unlike the delta arrival time.
      setStatuses((prev) => {
        const existing = prev.get(data.user_id);
        const nextMap = new Map(prev);
        nextMap.set(data.user_id, {
          user_id: data.user_id,
          is_online: false,
          last_seen: data.last_seen ?? existing?.last_seen,
        });
        return nextMap;
      });
    };

    const unsubs = [
      wsService.on("presence_snapshot", onSnapshot),
      wsService.on("user_online", onOnline),
      wsService.on("user_offline", onOffline),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
      for (const room of rooms) wsService.unsubscribeShared(room);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdsKey]);

  return statuses;
}
