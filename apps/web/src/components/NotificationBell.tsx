import { useEffect, useState, useRef } from "react";
import { useNotificationStore } from "@/stores/notificationStore";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";

export const NotificationBell = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const [showCard, setShowCard] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const allNotifications = useNotificationStore((s) => s.notifications);
  const notifications = allNotifications.slice(0, 5);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const init = useNotificationStore((s) => s.init);
  const markAsRead = useNotificationStore((s) => s.markAsRead);

  useEffect(() => {
    init(userId);
  }, [userId, init]);

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
                {notifications.map((notif) => {
                  const isFriendEvent = notif.type === "friend_request" || notif.type === "friend_accepted";
                  // Friend events have no related_post_id (FK constraint) — message already shows username.
                  // Non-friend events with related_post_id still link to /profile/{uuid}.
                  const link = !isFriendEvent && notif.related_post_id
                    ? `/profile/${notif.related_post_id}`
                    : notif.related_thread_id
                    ? `/notify?thread=${notif.related_thread_id}`
                    : '#';

                  return (
                    <Link
                      key={notif.id}
                      to={link}
                      onMouseEnter={() => {
                        if (!notif.is_read) {
                          markAsRead(notif.id);
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
