import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PentagramLoader } from "@/components/PentagramLoader";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { HeaderUsername } from "@/components/HeaderUsername";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";

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

const Notify = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "unread">("newest");

  const loadNotifications = useCallback(async (userId: string) => {
    const { data } = await api
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (data) {
      const notificationsWithSlugs = await Promise.all(
        data.map(async (notif) => {
          if (notif.related_thread_id) {
            const { data: threadData } = await api
              .from("threads")
              .select("board_id")
              .eq("id", notif.related_thread_id)
              .single();
            
            if (threadData) {
              const { data: boardData } = await api
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
      
      // Sort notifications
      const sorted = [...notificationsWithSlugs];
      if (sortBy === "oldest") {
        sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      } else if (sortBy === "unread") {
        sorted.sort((a, b) => {
          if (a.is_read === b.is_read) {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }
          return a.is_read ? 1 : -1;
        });
      }
      
      setNotifications(sorted);
    }
  }, [sortBy]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await api.auth.getUser();
      setUser(user);
      
      if (user) {
        await loadNotifications(user.id);
      }
      
      setLoading(false);
    };

    getUser();
  }, [loadNotifications]);

  const markAsRead = async (id: string) => {
    // Immediately update local state
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );

    // Update database
    await api
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);

    // Reload to ensure consistency
    if (user) await loadNotifications(user.id);
  };

  const markAllAsRead = async () => {
    if (!user) return;

    // Immediately update local state
    setNotifications(prev =>
      prev.map(n => ({ ...n, is_read: true }))
    );

    // Update database
    await api
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    await loadNotifications(user.id);
  };

  useEffect(() => {
    if (user) {
      loadNotifications(user.id);
    }
  }, [sortBy, user, loadNotifications]);

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

            {notifications.length === 0 ? (
              <div className="bg-card border border-border p-8 text-center">
                <p className="text-muted-foreground">Нет уведомлений</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notif) => {
                  const link = notif.related_thread_id && notif.thread_slug 
                    ? `/${notif.thread_slug}/thread/${notif.related_thread_id}`
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
                            {formatDistanceToNow(new Date(notif.created_at), {
                              locale: ru,
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </main>
  );
};

export default Notify;
