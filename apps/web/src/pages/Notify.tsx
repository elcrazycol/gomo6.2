import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type Notification } from "@/integrations/api/client";
import { useNotificationStore } from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { NotificationItem } from "@/components/NotificationItem";
import { ArrowLeft, CheckCheck } from "lucide-react";

interface NotifWithSlug extends Notification {
  thread_slug?: string;
}

const Notify = () => {
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
    if (user) {
      resetAndFetch(tab === "unread" ? "false" : undefined);
    }
  }, [tab, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    attachSlugs(notifications).then(setSlugifiedNotifs);
  }, [notifications, attachSlugs]);

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
  }, [hasMore, isLoadingMore, fetchMore]);

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
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-9 w-9" title="Назад">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="flex-1 text-lg font-bold">Уведомления</h1>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={markAllAsRead}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              title="Прочитать все"
            >
              <CheckCheck className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex">
          {(["all", "unread"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`relative flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "all" ? "Все" : "Непрочитанные"}
                {active && <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      </header>

      {slugifiedNotifs.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {tab === "unread" ? "Нет непрочитанных уведомлений" : "Нет уведомлений"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {slugifiedNotifs.map((notif) => (
            <NotificationItem
              key={notif.id}
              notification={notif}
              threadSlug={notif.thread_slug}
              onOpen={(id) => {
                if (!notif.is_read) markAsRead(id);
              }}
            />
          ))}

          <div ref={sentinelRef} className="h-4" />

          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <PentagramLoader size="sm" />
            </div>
          )}

          {!hasMore && slugifiedNotifs.length > 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Все уведомления загружены
            </p>
          )}
        </div>
      )}
    </main>
  );
};

export default Notify;
