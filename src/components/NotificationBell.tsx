import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface Notification {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  related_thread_id: string | null;
  related_post_id: string | null;
  thread_slug?: string;
}

export const NotificationBell = ({ userId }: { userId: string }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    loadNotifications();

    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const loadNotifications = async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) {
      // Fetch board slugs for each notification with a thread
      const notificationsWithSlugs = await Promise.all(
        data.map(async (notif) => {
          if (notif.related_thread_id) {
            const { data: threadData } = await supabase
              .from("threads")
              .select("board_id")
              .eq("id", notif.related_thread_id)
              .single();
            
            if (threadData) {
              const { data: boardData } = await supabase
                .from("boards")
                .select("slug")
                .eq("id", threadData.board_id)
                .single();
              
              return { ...notif, thread_slug: boardData?.slug };
            }
          }
          return notif;
        })
      );
      
      setNotifications(notificationsWithSlugs);
      setUnreadCount(notificationsWithSlugs.filter(n => !n.is_read).length);
    }
  };

  const markAsRead = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);
    loadNotifications();
  };

  const markAllAsRead = async () => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    loadNotifications();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative hover:bg-white/20 hover:text-white transition-colors">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-background border-border">
        <div className="space-y-2">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold">Уведомления</h3>
            {unreadCount > 0 && (
              <Button variant="link" size="sm" onClick={markAllAsRead} className="hover:text-primary transition-colors">
                Прочитать все
              </Button>
            )}
          </div>
          
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Нет уведомлений
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {notifications.map((notif) => {
                const link = notif.related_thread_id && notif.thread_slug 
                  ? `/${notif.thread_slug}/thread/${notif.related_thread_id}`
                  : '#';
                
                return (
                  <Link
                    key={notif.id}
                    to={link}
                    onClick={() => markAsRead(notif.id)}
                    className={`block p-3 border border-border hover:bg-primary/10 hover:border-primary/20 transition-colors ${
                      !notif.is_read ? "bg-primary/5 border-primary/20" : ""
                    }`}
                  >
                    <p className="font-bold text-sm">{notif.title}</p>
                    <p className="text-xs text-muted-foreground">{notif.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notif.created_at), {
                        locale: ru,
                        addSuffix: true,
                      })}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
