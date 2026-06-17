import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type Notification } from "@/integrations/api/client";
import { useNotificationStore } from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PentagramLoader } from "@/components/PentagramLoader";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";
import { ArrowLeft } from "lucide-react";

interface NotifWithSlug extends Notification {
  thread_slug?: string;
  board_slug?: string;
}

const Notify = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "unread">("newest");
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
    const withSlugs = await Promise.all(
      notifs.map(async (notif): Promise<NotifWithSlug> => {
        if (!notif.related_thread_id) return notif as NotifWithSlug;
        try {
          const threadResp = await apiClient.request<{ data: { board_id?: string } }>(
            `/api/v1/threads/${notif.related_thread_id}?select=board_id`
          );
          const threadData = (threadResp as { data?: { board_id?: string } }).data;
          if (threadData?.board_id) {
            const boardResp = await apiClient.request<{ data: Array<{ slug?: string }> }>(
              `/api/v1/boards?id=eq.${threadData.board_id}&select=slug`
            );
            const boardDataArr = (boardResp as { data?: Array<{ slug?: string }> }).data;
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
      const isRead = sortBy === "unread" ? "false" : undefined;
      resetAndFetch(isRead);
    }
  }, [sortBy, user]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleMarkAsRead = (id: string) => {
    markAsRead(id);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead();
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

  const displayNotifications = (() => {
    const sorted = [...slugifiedNotifs];
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
              <Button variant="outline" size="sm" onClick={handleMarkAllAsRead}>
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
                <a
                  key={notif.id}
                  href={link}
                  onMouseEnter={() => {
                    if (!notif.is_read) {
                      handleMarkAsRead(notif.id);
                    }
                  }}
                  onClick={(e) => {
                    handleMarkAsRead(notif.id);
                    if (link !== '#') {
                      e.preventDefault();
                      navigate(link);
                    }
                  }}
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
                </a>
              );
            })}

            <div ref={sentinelRef} className="h-4" />

            {isLoadingMore && (
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
