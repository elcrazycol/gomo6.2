import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";
import { HeaderIconButton } from "@/components/HeaderIconButton";
import { INK_ATTR } from "@/components/ui/ink-bar";
import { NotificationItem } from "@/components/NotificationItem";
import { UnreadBadge } from "@/components/UnreadBadge";
import { PentagramLoader } from "@/components/PentagramLoader";

/**
 * The bell and its preview panel.
 *
 * Hover opens the panel; the cursor LEAVING the bell-or-panel zone closes it
 * after a short grace delay (the timer bridges the dead gap between the
 * button and the floating panel, and lets the mouse trip over the edge
 * without killing the panel). Outside click + Escape still close it too, so
 * keyboard and touch users are not stranded.
 */
export const NotificationBell = ({ userId }: { userId: string }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // On the notifications page itself the preview is pointless — hovering the
  // bell there used to pop the mini panel over the very list it duplicates.
  const onNotificationsPage = pathname.startsWith("/notify");
  const [showCard, setShowCard] = useState(false);
  // Hover preview only makes sense with a fine pointer (mouse). On touch
  // devices a tap must go straight to the /notify page.
  const [canHover, setCanHover] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => setShowCard(false), 160);
  }, [cancelScheduledClose]);

  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

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

  // Landing on /notify must drop the panel even if it was open.
  useEffect(() => {
    if (onNotificationsPage) setShowCard(false);
  }, [onNotificationsPage]);

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
  const listScrollContext = useRef({ hasMore, isLoadingMore, fetchMore });
  listScrollContext.current = { hasMore, isLoadingMore, fetchMore };
  const onListScroll = useCallback(() => {
    const { hasMore, isLoadingMore, fetchMore } = listScrollContext.current;
    const el = listRef.current;
    if (!el || !hasMore || isLoadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 96) void fetchMore();
  }, []);

  return (
    <div
      className="relative z-10"
      ref={rootRef}
      {...{ [INK_ATTR]: true }}
      onMouseEnter={
        canHover && !onNotificationsPage
          ? () => { cancelScheduledClose(); setShowCard(true); }
          : undefined
      }
      onMouseLeave={canHover && !onNotificationsPage ? scheduleClose : undefined}
    >
      <HeaderIconButton
        label={t("nav.notifications")}
        active={onNotificationsPage}
        ink={false}
        badge={<UnreadBadge count={unreadCount} />}
        onClick={() => {
          if (!onNotificationsPage) navigate("/notify");
        }}
      >
        <Bell className="h-4 w-4" />
      </HeaderIconButton>

      {canHover && !onNotificationsPage && showCard && (
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
              className="max-h-[min(35vh,17rem)] divide-y divide-border/60 overflow-y-auto overscroll-contain"
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
