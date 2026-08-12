// Live presence for messenger conversation partners.
//
// While the messenger is open we subscribe to the presence_<userID> rooms of
// the 1:1 conversation partners (the sidebar dots + chat header show their
// online state). The backend replies with an immediate presence_snapshot per
// room and then sends user_online / user_offline deltas; everything lands in
// the messenger store via setUserPresence, so ConversationList and ChatView
// re-render without any polling.
import { useEffect, useMemo } from "react";
import { useMessengerStore } from "@/stores/messengerStore";
import { wsService, type WebSocketMessage } from "@/services/websocket";
import { presenceDataFromMessage } from "@/utils/presence";

// The conversation list is sorted by last_message_at desc, so capping at the
// most recent partners covers everything visible on screen. The rest keep
// their REST-loaded other_is_online / other_last_seen_at values.
const MAX_CONVERSATION_PRESENCE = 30;

const presenceRoom = (userId: string): string => `presence_${userId}`;

export function useMessengerPresence(): void {
  const conversations = useMessengerStore((s) => s.conversations);
  const meId = useMessengerStore((s) => s.me?.id ?? null);

  // Stable key of the partners we want live presence for (deduped, capped).
  const partnerKey = useMemo(() => {
    const ids = conversations
      .filter(
        (c) => !c.is_group && !c.is_notes && Boolean(c.other_user_id) && c.other_user_id !== meId,
      )
      .map((c) => c.other_user_id as string);
    return [...new Set(ids)].slice(0, MAX_CONVERSATION_PRESENCE).join(",");
  }, [conversations, meId]);

  useEffect(() => {
    if (!partnerKey) return;
    const partnerIds = partnerKey.split(",").filter(Boolean);
    const rooms = partnerIds.map(presenceRoom);
    for (const room of rooms) wsService.subscribeShared(room);

    const isPartner = (userId: string): boolean => partnerIds.includes(userId);

    const onSnapshot = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || !isPartner(data.user_id)) return;
      useMessengerStore.getState().setUserPresence(data.user_id, data.is_online ?? false, data.last_seen ?? null);
    };

    const onOnline = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || !isPartner(data.user_id)) return;
      useMessengerStore.getState().setUserPresence(data.user_id, true, data.last_seen ?? null);
    };

    const onOffline = (message: WebSocketMessage) => {
      const data = presenceDataFromMessage(message);
      if (!data || !isPartner(data.user_id)) return;
      // No last_seen in deltas: pass null so the store keeps the last known
      // value (the snapshot / REST carry the real last activity).
      useMessengerStore.getState().setUserPresence(data.user_id, false, data.last_seen ?? null);
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
  }, [partnerKey]);
}
