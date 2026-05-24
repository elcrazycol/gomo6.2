import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/api/supabaseCompat";

export const ChatIcon = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const loadUnread = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("type", "message")
        .eq("is_read", false);

      if (mounted) {
        setUnreadCount(count ?? 0);
      }
    };

    void loadUnread();

    const channel = supabase
      .channel(`messenger-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void loadUnread()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

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
