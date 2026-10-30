import { MessageCircle } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useMessengerStore } from "@/stores/messengerStore";
import { messengerWs } from "@/services/messengerWebSocket";
import { eventManager } from "@/services/eventManager";
import { warmRouteIntent } from "@/lib/routeChunks";
import { HeaderIconButton } from "@/components/HeaderIconButton";
import { UnreadBadge } from "@/components/UnreadBadge";

export const ChatIcon = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const conversations = useMessengerStore((s) => s.conversations);
  const init = useMessengerStore((s) => s.init);

  const unreadCount = conversations.reduce(
    (sum, c) => sum + (c.unread_count ?? 0),
    0,
  );

  // Initialize messenger store + connect WS handlers once when userId becomes available
  useEffect(() => {
    if (!userId) return;
    init().then(() => {
      messengerWs.connect();
      // Ensure eventManager is initialized (may already be from NotificationBell)
      eventManager.init(userId);
    });
  }, [userId, init]);

  // Track subscribed conversation IDs to avoid re-subscribing on every store update
  const subscribedIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to newly added conversation rooms reactively via EventManager.
  useEffect(() => {
    const currentIds = new Set(conversations.map((c) => c.id));
    for (const id of currentIds) {
      if (!subscribedIdsRef.current.has(id)) {
        eventManager.subscribeConversation(id);
      }
    }
    subscribedIdsRef.current = currentIds;
  }, [conversations]);

  return (
    <HeaderIconButton
      label="Открыть мессенджер"
      active={pathname === "/messages" || pathname.startsWith("/messages/")}
      badge={<UnreadBadge count={unreadCount} />}
      onClick={() => {
        // No hover intent on a button: warm the chunk + data first so the
        // instant swap lands on cache instead of a cold fetch.
        warmRouteIntent("/messages");
        navigate("/messages");
      }}
    >
      <MessageCircle className="h-4 w-4" />
    </HeaderIconButton>
  );
};
