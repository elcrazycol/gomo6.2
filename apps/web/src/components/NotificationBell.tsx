import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { NotificationItem } from "@/components/NotificationItem";
import { UnreadBadge } from "@/components/UnreadBadge";
import { PentagramLoader } from "@/components/PentagramLoader";

/**
 * The bell and its preview panel.
 *
 * Hover opens the panel, but it closes ONLY on an outside click (or Escape):
 * the old auto-close on mouse-leave made the list impossible to scroll. The
 * panel shows the whole loaded history and pulls older pages as its list nears
 * the end, so it is usable as a lightweight inbox, not just the last handful.
 */
export const NotificationBell = ({ userId }: { userId: string }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showCard, setShowCard] = useState(false);
  // Hover preview only makes sense with a fine pointer (mouse). On touch
  // devices a tap must go straight to the /notify page.
  const [canHover, setCanHover] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const hasMore = useNotificationStore((s) => s.hasMore);
  const isLoadingMore = useNotificationStore((s) => s.isLoadingMore);
  const init = useNotificationStore((s) => s.init);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const fetchMore = useNotificationStore((s) => s.fetchMore);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = (e?: MediaQueryListEvent) => setCanHover(e ? e.matches : mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    init(userId);
  }, [userId, init]);

  useEffect(() => {
    if (!showCard) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setShowCard(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCard(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showCard]);

  // Pull older notifications as the panel's list approaches the bottom.
  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || !hasMore || isLoadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 96) void fetchMore();
  }, [hasMore, isLoadingMore, fetchMore]);

  return (
    <div
      className="relative"
      ref={rootRef}
      onMouseEnter={canHover ? () => setShowCard(true) : undefined}
    >
      <Button
        variant="ghost"
        className="relative h-8 w-8 p-0 hover:bg-[hsl(var(--foreground)/0.12)] transition-colors group"
        onClick={() => navigate("/notify")}
      >
        <Bell className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
        <UnreadBadge count={unreadCount} />
      </Button>

      {canHover && showCard && (
        <div className="absolute top-full right-0 mt-2 z-50 w-[22rem] max-w-[calc(100vw-2rem)] bg-background text-foreground border border-border rounded-2xl shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <h3 className="font-bold">{t("nav.notifications")}</h3>
            <Link
              to="/notify"
              className="text-xs text-primary hover:underline"
              onClick={() => setShowCard(false)}
            >
              {t("notif.viewAll")}
            </Link>
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("notif.noNotifications")}
            </p>
          ) : (
            <div
              ref={listRef}
              onScroll={onListScroll}
              className="max-h-[min(70vh,34rem)] divide-y divide-border/60 overflow-y-auto overscroll-contain"
            >
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

              {isLoadingMore && (
                <div className="flex justify-center py-3">
                  <PentagramLoader size="sm" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
