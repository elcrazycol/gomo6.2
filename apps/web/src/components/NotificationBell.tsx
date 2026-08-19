import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { NotificationItem } from "@/components/NotificationItem";

export const NotificationBell = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const [showCard, setShowCard] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const allNotifications = useNotificationStore((s) => s.notifications);
  const notifications = allNotifications.slice(0, 6);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const init = useNotificationStore((s) => s.init);
  const markAsRead = useNotificationStore((s) => s.markAsRead);

  useEffect(() => {
    init(userId);
  }, [userId, init]);

  const clearCloseTimer = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimeoutRef.current = setTimeout(() => setShowCard(false), 250);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group"
        onClick={() => navigate("/notify")}
        onMouseEnter={() => {
          clearCloseTimer();
          setShowCard(true);
        }}
        onMouseLeave={scheduleClose}
      >
        <Bell className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {showCard && (
        <div
          className="absolute top-full right-0 mt-2 z-50 w-[22rem] max-w-[calc(100vw-2rem)] bg-background text-foreground border border-border rounded-2xl shadow-lg overflow-hidden"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <h3 className="font-bold">Уведомления</h3>
            <Link to="/notify" className="text-xs text-primary hover:underline">
              Все →
            </Link>
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Нет уведомлений
            </p>
          ) : (
            <div className="max-h-96 divide-y divide-border/60 overflow-y-auto">
              {notifications.map((notif) => (
                <NotificationItem
                  key={notif.id}
                  notification={notif}
                  onOpen={(id) => {
                    if (!notif.is_read) markAsRead(id);
                    setShowCard(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
