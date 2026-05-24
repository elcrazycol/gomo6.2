import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiClient } from "@/integrations/api/client";

export const ChatIcon = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const loadUnread = useCallback(async () => {
    try {
      const resp = await apiClient.getMessengerUnreadCount();
      const d = resp.data as { unread_count: number } | null;
      setUnreadCount(d?.unread_count ?? 0);
    } catch (err) {
      console.error("[ChatIcon] Failed to load messenger unread count:", err);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    loadUnread();

    // Poll every 30 seconds
    pollingRef.current = setInterval(loadUnread, 30000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [userId, loadUnread]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group"
      onClick={() => navigate("/messages")}
      aria-label="Открыть мессенджер"
    >
      <MessageCircle className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
      {unreadCount > 0 ? (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
          {unreadCount}
        </span>
      ) : null}
    </Button>
  );
};
