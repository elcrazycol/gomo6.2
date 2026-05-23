import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/api/client_simple";
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
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadNotifications = useCallback(async () => {
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
  }, [userId]);

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
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, [userId, loadNotifications]);


  const handleClick = () => {
    navigate("/notify");
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group"
        onClick={handleClick}
        onMouseEnter={() => {
          if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
          }
          setShowCard(true);
        }}
        onMouseLeave={() => {
          closeTimeoutRef.current = setTimeout(() => {
            setShowCard(false);
          }, 300);
        }}
      >
        <Bell className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </Button>

      {showCard && (
        <div
          className="absolute top-full right-0 mt-1 z-50 w-80 bg-background/95 text-foreground backdrop-blur-md border border-border rounded-lg shadow-lg p-4"
          onMouseEnter={() => {
            if (closeTimeoutRef.current) {
              clearTimeout(closeTimeoutRef.current);
              closeTimeoutRef.current = null;
            }
          }}
          onMouseLeave={() => {
            closeTimeoutRef.current = setTimeout(() => {
              setShowCard(false);
            }, 300);
          }}
        >
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
                      onMouseEnter={() => {
                        if (!notif.is_read) {
                          // Immediately update local state
                          setNotifications(prev =>
                            prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n)
                          );
                          // Update unread count immediately
                          setUnreadCount(prev => Math.max(0, prev - 1));
                          // Mark as read in database (async)
                          supabase
                            .from('notifications')
                            .update({ is_read: true })
                            .eq('id', notif.id)
                            .then(() => {
                              // Reload notifications to ensure consistency
                              loadNotifications();
                            });
                        }
                      }}
                      className={`block p-3 border text-foreground transition-all duration-200 rounded relative ${
                        !notif.is_read
                          ? "bg-muted/30 border-muted-foreground/20 border-l-2 border-l-muted-foreground/40"
                          : "border-border hover:bg-primary/10 hover:border-primary/20"
                      }`}
                    >
                      <p className="font-bold text-sm text-foreground">{notif.title}</p>
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
