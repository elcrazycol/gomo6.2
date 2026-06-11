import { useEffect, useState, useRef, useCallback } from "react";
import { apiClient, type Notification } from "@/integrations/api/client";
import { wsService } from "@/services/websocket";
import type { WebSocketMessage } from "@/services/websocket";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";

export const NotificationBell = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const loadUnreadCount = useCallback(async () => {
    try {
      const countResp = await apiClient.getUnreadNotificationsCount();
      if (countResp.data) {
        const d = countResp.data as { unread_count: number };
        setUnreadCount(d.unread_count);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const notifResp = await apiClient.getNotifications({ limit: 10 });
      if (notifResp.data && Array.isArray(notifResp.data)) {
        const serverNotifs = notifResp.data as Notification[];
        // Merge with existing: keep WS-delivered notifications, update from server
        setNotifications(prev => {
          const serverIds = new Set(serverNotifs.map(n => n.id));
          // Start with server notifications
          const merged = [...serverNotifs];
          // Add any WS notifications not present in server response
          for (const n of prev) {
            if (!serverIds.has(n.id)) {
              merged.push(n);
            }
          }
          return merged.slice(0, 10);
        });
      }
      // Always fetch actual unread count from dedicated endpoint
      await loadUnreadCount();
    } catch (err) {
      console.error("[NotificationBell] Failed to load notifications:", err);
    }
  }, [loadUnreadCount]);

  // WebSocket real-time handler for new notifications
  const handleNewNotification = useCallback((message: WebSocketMessage) => {
    const notif = message.data as Notification;
    if (!notif || !notif.id) return;

    setNotifications(prev => {
      // Dedup: remove if already present, then prepend
      const filtered = prev.filter(n => n.id !== notif.id);
      return [notif, ...filtered].slice(0, 10);
    });

    // Only increment if not already read
    if (!notif.is_read) {
      setUnreadCount(prev => prev + 1);
    }
  }, []);

  // Main effect: subscribe to WS, poll only when disconnected
  useEffect(() => {
    if (!userId) return;

    // Initial load
    loadNotifications();

    // Subscribe to notification room
    wsService.subscribeToNotifications(userId);

    // Listen for real-time notification events
    const unsubscribe = wsService.on('new_notification', handleNewNotification);

    // Poll every 60 seconds ONLY as fallback when WS is disconnected
    pollingRef.current = setInterval(() => {
      if (!wsService.connected) {
        loadNotifications();
      }
    }, 60000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      unsubscribe();
    };
  }, [userId, loadNotifications, handleNewNotification]);

  // Re-subscribe on connect (in case WS reconnects)
  useEffect(() => {
    if (!userId) return;

    const unsubscribeConnected = wsService.on('connected', () => {
      wsService.subscribeToNotifications(userId);
      // Refresh notifications immediately on reconnect
      loadNotifications();
    });

    return () => {
      unsubscribeConnected();
    };
  }, [userId, loadNotifications]);

  const handleClick = () => {
    navigate("/notify");
  };

  const markAsRead = async (notif: Notification) => {
    if (notif.is_read) return;

    // Optimistic UI update
    setNotifications(prev =>
      prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    try {
      await apiClient.markNotificationAsRead(notif.id);
    } catch {
      // Silently ignore — notification read status is updated optimistically
    }
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
            {unreadCount > 99 ? "99+" : unreadCount}
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
                  const link = notif.related_thread_id 
                    ? `/notify?thread=${notif.related_thread_id}`
                    : '#';
                  
                  return (
                    <Link
                      key={notif.id}
                      to={link}
                      onMouseEnter={() => {
                        if (!notif.is_read) {
                          markAsRead(notif);
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
                        {formatDistanceToNow(safeDate(notif.created_at), {
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
