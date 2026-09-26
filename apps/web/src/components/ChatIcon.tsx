import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useMessengerStore } from "@/stores/messengerStore";
import { messengerWs } from "@/services/messengerWebSocket";
import { eventManager } from "@/services/eventManager";
import { UnreadBadge } from "@/components/UnreadBadge";

export const ChatIcon = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
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
    <Button
      variant="ghost"
      className="relative h-8 w-8 p-0 hover:bg-[hsl(var(--foreground)/0.12)] transition-colors group"
      onClick={() => navigate("/messages")}
      aria-label="Открыть мессенджер"
    >
      <MessageCircle className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full" />
      <UnreadBadge count={unreadCount} />
    </Button>
  );
};
