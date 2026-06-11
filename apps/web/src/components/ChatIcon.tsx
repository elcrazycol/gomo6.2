import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useMessengerStore } from "@/stores/messengerStore";
import { messengerWs } from "@/services/messengerWebSocket";

export const ChatIcon = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const conversations = useMessengerStore((s) => s.conversations);
  const init = useMessengerStore((s) => s.init);

  // Compute unread from store — fully reactive, no polling needed
  const unreadCount = conversations.reduce(
    (sum, c) => sum + (c.unread_count ?? 0),
    0,
  );

  // Initialize store + connect WS once when userId becomes available
  useEffect(() => {
    if (!userId) return;
    init().then(() => {
      messengerWs.connect();
    });
  }, [userId, init]);

  // Track subscribed conversation IDs to avoid re-subscribing on every store update
  const subscribedIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to newly added conversation rooms reactively.
  // This ensures newly created conversations get realtime events immediately,
  // without needing a page reload.
  useEffect(() => {
    const currentIds = new Set(conversations.map((c) => c.id));
    for (const id of currentIds) {
      if (!subscribedIdsRef.current.has(id)) {
        messengerWs.subscribe(`chat_${id}`);
      }
    }
    subscribedIdsRef.current = currentIds;
  }, [conversations]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group"
      onClick={() => navigate("/messages")}
      aria-label="Открыть мессенджер"
    >
      <MessageCircle className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Button>
  );
};
