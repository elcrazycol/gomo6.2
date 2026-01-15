import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [viewedNotifications, setViewedNotifications] = useState<Set<string>>(new Set());

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

  // Mark notifications as read when viewed
  useEffect(() => {
    if (showCard && notifications.length > 0) {
      const unreadIds = notifications
        .filter(n => !n.is_read && !viewedNotifications.has(n.id))
        .map(n => n.id);
      
      if (unreadIds.length > 0) {
        // Mark as read in database
        supabase
          .from("notifications")
          .update({ is_read: true })
          .in("id", unreadIds);
        
        // Add to viewed set
        setViewedNotifications(prev => {
          const newSet = new Set(prev);
          unreadIds.forEach(id => newSet.add(id));
          return newSet;
        });
        
        // Reload to update count
        loadNotifications();
      }
    }
  }, [showCard, notifications, viewedNotifications]);

  const handleClick = () => {
    navigate("/notify");
  };

  return (
    <div className="relative">
      <Button 
        variant="ghost" 
        size="sm" 
        className="relative hover:bg-white/20 hover:text-white transition-colors"
        onClick={handleClick}
        onMouseEnter={() => setShowCard(true)}
        onMouseLeave={() => setShowCard(false)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </Button>

      {showCard && (
        <div className="absolute top-full right-0 mt-1 z-50 w-80 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-lg p-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold">Уведомления</h3>
              <Link to="/notify" className="text-xs text-primary hover:underline">
                Все →
              </Link>
            </div>
            
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Нет уведомлений
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {notifications.slice(0, 5).map((notif) => {
                  const link = notif.related_thread_id && notif.thread_slug 
                    ? `/${notif.thread_slug}/thread/${notif.related_thread_id}`
                    : '#';
                  
                  return (
                    <Link
                      key={notif.id}
                      to={link}
                      className={`block p-3 border border-border hover:bg-primary/10 hover:border-primary/20 transition-colors rounded ${
                        !notif.is_read && !viewedNotifications.has(notif.id) ? "bg-primary/5 border-primary/20" : ""
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
        </div>
      )}
    </div>
  );
};
