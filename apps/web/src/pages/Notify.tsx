import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiClient, type Notification } from "@/integrations/api/client";
import { useNotificationStore } from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { NotificationItem } from "@/components/NotificationItem";
import { ArrowLeft, CheckCheck } from "lucide-react";
import { normalizeLanguage } from "@/i18n/languages";
import { groupByDay, type NotifWithSlug } from "@/utils/notificationGroups";

/**
 * A row that marks its notification read once it has actually been on screen
 * for a second — scrolling through the inbox clears the unread badge the way
 * reading it would, without requiring a click on every item.
 */
const ReadOnViewRow = ({
  notification,
  threadSlug,
  onOpen,
  onSeen,
}: {
  notification: NotifWithSlug;
  threadSlug?: string;
  onOpen?: (id: string) => void;
  onSeen: (id: string) => void;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (notification.is_read) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          if (!timer) timer = setTimeout(() => onSeen(notification.id), 1000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [notification.id, notification.is_read, onSeen]);

  return (
    <div ref={ref}>
      <NotificationItem notification={notification} threadSlug={threadSlug} onOpen={onOpen} />
    </div>
  );
};

/** Placeholder rows shown while the first page (or a tab switch) is loading. */
const NotificationListSkeleton = () => (
  <div className="divide-y divide-border/60">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex items-start gap-3 px-4 py-3">
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2 pt-0.5">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
);

const Notify = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [slugifiedNotifs, setSlugifiedNotifs] = useState<NotifWithSlug[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const notifications = useNotificationStore((s) => s.notifications);
  const hasMore = useNotificationStore((s) => s.hasMore);
  const isLoadingMore = useNotificationStore((s) => s.isLoadingMore);
  const isLoading = useNotificationStore((s) => s.isLoading);
  const activeFilter = useNotificationStore((s) => s.activeFilter);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchMore = useNotificationStore((s) => s.fetchMore);
  const resetAndFetch = useNotificationStore((s) => s.resetAndFetch);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);

  const attachSlugs = useCallback(async (notifs: Notification[]): Promise<NotifWithSlug[]> => {
    const threadIds = [...new Set(
      notifs.filter((n) => n.related_thread_id).map((n) => n.related_thread_id!)
    )];
    if (threadIds.length === 0) return notifs as NotifWithSlug[];

    const threadMap = new Map<string, string>();
    try {
      const threadResp = await apiClient.request<{ data: Array<{ id: string; board_id?: string }> }>(
        `/api/v1/threads?id=in.(${threadIds.join(',')})&select=id,board_id`
      );
      const threads = (threadResp as unknown as { data?: Array<{ id: string; board_id?: string }> }).data;
      if (Array.isArray(threads)) {
        for (const t of threads) {
          if (t.board_id) threadMap.set(t.id, t.board_id);
        }
      }
    } catch {
      // Best effort
    }

    const boardIds = [...new Set(threadMap.values())];
    const boardSlugMap = new Map<string, string>();
    if (boardIds.length > 0) {
      try {
        const boardResp = await apiClient.request<{ data: Array<{ id: string; slug?: string }> }>(
          `/api/v1/boards?id=in.(${boardIds.join(',')})&select=id,slug`
        );
        const boards = (boardResp as unknown as { data?: Array<{ id: string; slug?: string }> }).data;
        if (Array.isArray(boards)) {
          for (const b of boards) {
            if (b.slug) boardSlugMap.set(b.id, b.slug);
          }
        }
      } catch {
        // Best effort
      }
    }

    return notifs.map((notif): NotifWithSlug => {
      if (!notif.related_thread_id) return notif as NotifWithSlug;
      const boardId = threadMap.get(notif.related_thread_id);
      const slug = boardId ? boardSlugMap.get(boardId) : undefined;
      return { ...notif, thread_slug: slug } as NotifWithSlug;
    });
  }, []);

  useEffect(() => {
    const getUser = async () => {
      const userData = await apiClient.getCurrentUser();
      setUser(userData);
      setLoading(false);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (!user) return;
    const filter = tab === "unread" ? "false" : undefined;
    // The bell usually preloaded this exact list — resetting it would clear the
    // rows and flash «нет уведомлений» for a frame.
    if (activeFilter === filter && notifications.length > 0) return;
    resetAndFetch(filter);
  }, [tab, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    attachSlugs(notifications).then(setSlugifiedNotifs);
  }, [notifications, attachSlugs]);

  const dateLocale = normalizeLanguage(i18n.language) === "en" ? "en-US" : "ru-RU";
  const groups = useMemo(
    () => groupByDay(slugifiedNotifs, new Date(), t, dateLocale),
    [slugifiedNotifs, t, dateLocale],
  );
  // Pending while the store loads, and for the tick between the store list
  // arriving and attachSlugs resolving it into `slugifiedNotifs` — without this
  // the empty state flashed for a frame before the rows appeared.
  const listPending = isLoading || (notifications.length > 0 && slugifiedNotifs.length === 0);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) {
          fetchMore();
        }
      },
      { threshold: 0.1 }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
    // `slugifiedNotifs.length` matters: on the first render the page is still
    // showing its loader, so there is no sentinel to observe — without this the
    // observer was never attached once the list appeared and the inbox silently
    // stopped after the first page.
  }, [hasMore, isLoadingMore, fetchMore, slugifiedNotifs.length]);

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  return (
    <main className="mx-auto w-full max-w-2xl">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="flex items-center gap-1 px-2 py-2.5">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-9 w-9" title={t("common.back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="flex-1 text-lg font-bold">{t("nav.notifications")}</h1>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={markAllAsRead}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              title={t("notif.markAllRead")}
            >
              <CheckCheck className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex">
          {(["all", "unread"] as const).map((tabKey) => {
            const active = tab === tabKey;
            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => setTab(tabKey)}
                className={`relative flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tabKey === "all" ? t("notif.all") : t("notif.unread")}
                {active && <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      </header>

      {groups.length === 0 && listPending ? (
        <NotificationListSkeleton />
      ) : groups.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {tab === "unread" ? t("notif.noUnreadNotifications") : t("notif.noNotifications")}
          </p>
        </div>
      ) : (
        <div>
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="border-b border-border/60 bg-muted/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <div className="divide-y divide-border/60">
                {group.items.map((notif) => (
                  <ReadOnViewRow
                    key={notif.id}
                    notification={notif}
                    threadSlug={notif.thread_slug}
                    onSeen={markAsRead}
                    onOpen={(id) => {
                      if (!notif.is_read) markAsRead(id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}

          <div ref={sentinelRef} data-testid="notify-sentinel" className="h-4" />

          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <PentagramLoader size="sm" />
            </div>
          )}

          {!hasMore && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("notif.allLoaded")}
            </p>
          )}
        </div>
      )}
    </main>
  );
};

export default Notify;
