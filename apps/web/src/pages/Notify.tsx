import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiClient, type Notification } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PentagramLoader } from "@/components/PentagramLoader";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";


interface NotifWithSlug extends Notification {
  thread_slug?: string;
  board_slug?: string;
}

const PAGE_SIZE = 20;

const Notify = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotifWithSlug[]>([]);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "unread">("newest");
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Attach board slugs to notifications — all lookups in parallel across notifications
  const attachSlugs = useCallback(async (notifs: Notification[]): Promise<NotifWithSlug[]> => {
    const withSlugs = await Promise.all(
      notifs.map(async (notif): Promise<NotifWithSlug> => {
        if (!notif.related_thread_id) return notif as NotifWithSlug;
        try {
          const threadResp = await apiClient.request<{ data: { board_id?: string } }>(
            `/api/v1/threads/${notif.related_thread_id}?select=board_id`
          );
          const threadData = threadResp.data;
          if (threadData?.board_id) {
            const boardResp = await apiClient.request<{ data: Array<{ slug?: string }> }>(
              `/api/v1/boards?id=eq.${threadData.board_id}&select=slug`
            );
            const boardDataArr = boardResp.data;
            if (Array.isArray(boardDataArr) && boardDataArr.length > 0) {
              return { ...notif, thread_slug: boardDataArr[0]?.slug } as NotifWithSlug;
            }
          }
        } catch {
          // Ignore individual lookup failures
        }
        return notif as NotifWithSlug;
      })
    );
    return withSlugs;
  }, []);

  const loadNotifications = useCallback(async (offset: number = 0) => {
    try {
      const params: { limit: number; offset: number } = { limit: PAGE_SIZE, offset };

      // Build query string manually for is_read filter
      let queryStr = `limit=${PAGE_SIZE}&offset=${offset}`;
      if (sortBy === "unread") {
        queryStr += "&is_read=false";
      }

      const notifResp = await apiClient.getNotifications(params);
      const data = notifResp.data as Notification[] | null;

      if (!data || !Array.isArray(data)) {
        if (offset === 0) setNotifications([]);
        setHasMore(false);
        return;
      }

      const withSlugs = await attachSlugs(data);

      if (offset === 0) {
        setNotifications(withSlugs);
      } else {
        setNotifications(prev => {
          const existingIds = new Set(prev.map(n => n.id));
          const newItems = withSlugs.filter(n => !existingIds.has(n.id));
          return [...prev, ...newItems];
        });
      }

      setHasMore(notifResp.has_more ?? data.length >= PAGE_SIZE);
    } catch {
      console.error("[Notify] Failed to load notifications:", err);
      if (offset === 0) setNotifications([]);
    }
  }, [sortBy, attachSlugs]);

  // Load more for infinite scroll
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    await loadNotifications(notifications.length);
    setLoadingMore(false);
  }, [loadingMore, hasMore, loadNotifications, notifications.length]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          loadMore();
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
  }, [hasMore, loadingMore, loadMore]);

  useEffect(() => {
    const getUser = async () => {
      const userData = await apiClient.getCurrentUser();
      setUser(userData);

      if (userData) {
        await loadNotifications(0);
      }

      setLoading(false);
    };

    getUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when sort changes
  useEffect(() => {
    if (user) {
      setNotifications([]);
      setHasMore(true);
      loadNotifications(0);
    }
  }, [sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAsRead = async (id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );

    try {
      await apiClient.markNotificationAsRead(id);
    } catch {
      console.error("[Notify] Failed to mark as read:", err);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    setNotifications(prev =>
      prev.map(n => ({ ...n, is_read: true }))
    );

    try {
      await apiClient.markAllNotificationsAsRead();
      // Reload to get fresh state
      setNotifications([]);
      setHasMore(true);
      await loadNotifications(0);
    } catch {
      console.error("[Notify] Failed to mark all as read:", err);
    }
  };

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

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Client-side sorting for "unread first" and "oldest first"
  const displayNotifications = (() => {
    const sorted = [...notifications];
    if (sortBy === "oldest") {
      sorted.sort((a, b) => safeDate(a.created_at).getTime() - safeDate(b.created_at).getTime());
    } else if (sortBy === "unread") {
      sorted.sort((a, b) => {
        if (a.is_read === b.is_read) {
          return safeDate(b.created_at).getTime() - safeDate(a.created_at).getTime();
        }
        return a.is_read ? 1 : -1;
      });
    }
    // "newest" is already in server order (desc)
    return sorted;
  })();

  return (
    <main className="max-w-4xl mx-auto p-4">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="p-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">Уведомления</h1>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                {unreadCount} непрочитанных
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={(val) => setSortBy(val as typeof sortBy)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Сначала новые</SelectItem>
                <SelectItem value="oldest">Сначала старые</SelectItem>
                <SelectItem value="unread">Непрочитанные</SelectItem>
              </SelectContent>
            </Select>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllAsRead}>
                Прочитать все
              </Button>
            )}
          </div>
        </div>

        {displayNotifications.length === 0 ? (
          <div className="bg-card border border-border p-8 text-center">
            <p className="text-muted-foreground">Нет уведомлений</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayNotifications.map((notif) => {
              const link = notif.related_thread_id && notif.thread_slug
                ? `/${notif.thread_slug}/thread/${notif.related_thread_id}`
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
                  onClick={() => markAsRead(notif.id)}
                  className={`block p-4 border text-foreground transition-all duration-200 rounded relative ${
                    !notif.is_read
                      ? "bg-muted/30 border-muted-foreground/20 border-l-2 border-l-muted-foreground/40"
                      : "border-border hover:bg-primary/10 hover:border-primary/20"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-bold text-base text-foreground">{notif.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">{notif.message}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {formatDistanceToNow(safeDate(notif.created_at), {
                          locale: ru,
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-4" />

            {loadingMore && (
              <div className="flex justify-center py-4">
                <PentagramLoader size="sm" />
              </div>
            )}

            {!hasMore && displayNotifications.length > 0 && (
              <p className="text-center text-xs text-muted-foreground py-4">
                Все уведомления загружены
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default Notify;
