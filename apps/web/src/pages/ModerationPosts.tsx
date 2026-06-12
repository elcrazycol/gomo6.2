import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { safeDate } from "@/utils/safeDate";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings } from "lucide-react";
import { storageUrl } from "@/utils/storage";

interface Report {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  reporter_id: string | null;
  reported_post_id: string | null;
  reported_thread_id: string | null;
  moderator_note: string | null;
}

interface ReportedContent {
  post?: {
    content: string;
    image_url: string | null;
    user_id: string;
    profiles?: {
      username: string;
    };
  };
  thread?: {
    title: string;
    content: string;
    image_url: string | null;
    user_id: string;
    profiles?: {
      username: string;
    };
  };
}

const Moderation = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<unknown>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [moderatorNote, setModeratorNote] = useState("");
  const [reportedContent, setReportedContent] = useState<Record<string, ReportedContent>>({});
  const [warningReason, setWarningReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState("7");

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await api.auth.getUser();
    
    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    const { data: roles } = await api
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isMod = roles?.some((r: { role: string }) => r.role === 'moderator' || r.role === 'admin');
    
    if (!isMod) {
      toast.error("У вас нет доступа к этой странице");
      navigate("/");
      return;
    }

    setIsModerator(true);

    // Load current user profile and color
    const { data: profile } = await api
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (profile) {
      setCurrentUserUsername(profile.username);
    }

    // Load current user color
    const { data: achievements } = await api
      .from("user_achievements")
      .select(`
        achievement_id,
        achievements (
          reward_type,
          reward_value
        )
      `)
      .eq("user_id", user.id);

    if (achievements) {
      const colorRewards = achievements
        .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>)?.reward_type === "username_color")
        .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

      const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
      for (const p of priority) {
        if (colorRewards.includes(p)) {
          setCurrentUserColor(p);
          break;
        }
      }
    }
  }, [navigate]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadReports = useCallback(async () => {
    try {
      const { data, error } = await api
        .from("reports")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setReports(data || []);
    } catch (error) {
      console.error("Error loading reports:", error);
      toast.error("Ошибка загрузки жалоб");
    }
  }, []);

  const loadReportContent = useCallback(async (report: Report) => {
    const content: ReportedContent = {};

    if (report.reported_post_id) {
      const { data: post } = await api
        .from("posts")
        .select(`
          content,
          image_url,
          user_id,
          profiles(username)
        `)
        .eq("id", report.reported_post_id)
        .single();
      
      if (post) {
        content.post = {
          content: post.content,
          image_url: post.image_url,
          user_id: post.user_id,
          profiles: Array.isArray(post.profiles) ? post.profiles[0] : post.profiles
        };
      }
    }

    if (report.reported_thread_id) {
      const { data: thread } = await api
        .from("threads")
        .select(`
          title,
          content,
          image_url,
          user_id,
          profiles(username)
        `)
        .eq("id", report.reported_thread_id)
        .single();
      
      if (thread) {
        content.thread = {
          title: thread.title,
          content: thread.content,
          image_url: thread.image_url,
          user_id: thread.user_id,
          profiles: Array.isArray(thread.profiles) ? thread.profiles[0] : thread.profiles
        };
      }
    }

    setReportedContent(prev => ({ ...prev, [report.id]: content }));
  }, []);

  const handleDeletePost = async (postId: string) => {
    const { error } = await api
      .from("posts")
      .delete()
      .eq("id", postId);

    if (error) {
      toast.error("Ошибка удаления поста");
    } else {
      toast.success("Пост удален");
      loadReports();
    }
  };

  const handleSendWarning = async (userId: string) => {
    if (!warningReason.trim()) {
      toast.error("Укажите причину предупреждения");
      return;
    }

    const { error } = await api
      .from("user_warnings")
      .insert({
        user_id: userId,
        warned_by: user.id,
        reason: warningReason.trim(),
      });

    if (error) {
      toast.error("Ошибка отправки предупреждения");
    } else {
      toast.success("Предупреждение отправлено");
      setWarningReason("");
    }
  };

  const handleBanUser = async (userId: string, isPermanent: boolean) => {
    if (!banReason.trim()) {
      toast.error("Укажите причину бана");
      return;
    }

    const expiresAt = isPermanent 
      ? null 
      : new Date(Date.now() + parseInt(banDays) * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await api
      .from("user_bans")
      .insert({
        user_id: userId,
        banned_by: user.id,
        reason: banReason.trim(),
        expires_at: expiresAt,
        is_permanent: isPermanent,
      });

    if (error) {
      toast.error("Ошибка выдачи бана");
    } else {
      toast.success(isPermanent ? "Пользователь забанен навсегда" : `Пользователь забанен на ${banDays} дней`);
      setBanReason("");
    }
  };

  const handleResolve = async (reportId: string, action: 'approve' | 'reject') => {
    const { error } = await api
      .from("reports")
      .update({
        status: action === 'approve' ? 'resolved' : 'rejected',
        moderator_id: user.id,
        moderator_note: moderatorNote,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", reportId);

    if (error) {
      toast.error("Ошибка обработки жалобы");
    } else {
      toast.success(action === 'approve' ? "Жалоба принята" : "Жалоба отклонена");
      setSelectedReport(null);
      setModeratorNote("");
      loadReports();
    }
  };

  if (!isModerator) return null;

  const pendingReports = reports.filter(r => r.status === 'pending');
  const resolvedReports = reports.filter(r => r.status !== 'pending');

  return (
    <div className="bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <Link to="/" className="text-xl font-bold hover:underline flex-shrink-0">
            gomo6
          </Link>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
              {user && (
                <ProfileHoverCard userId={user.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                        className={`text-sm sm:text-base hover:bg-white/20 hover:text-white transition-colors drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] ${
                          currentUserColor === 'purple' ? 'text-purple-500' :
                          currentUserColor === 'gold' ? 'text-yellow-500' :
                          currentUserColor === 'orange' ? 'text-orange-500' :
                          currentUserColor === 'red' ? 'text-red-500' :
                          currentUserColor === 'blue' ? 'text-blue-500' :
                          currentUserColor === 'green' ? 'text-green-500' :
                          currentUserColor === 'yellow' ? 'text-yellow-400' :
                          currentUserColor === 'cyan' ? 'text-cyan-500' :
                          'text-quote'
                        }`}
                    onClick={() => navigate(`/profile/${user.id}`)}
                  >
                    {currentUserUsername || 'Профиль'}
                  </Button>
                </ProfileHoverCard>
              )}
            </div>
            {user && (
              <MobileMenu
                user={user}
                isModerator={true}
              />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 sm:p-4">
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Новые ({pendingReports.length})
            </TabsTrigger>
            <TabsTrigger value="resolved">
              Обработанные ({resolvedReports.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4 mt-4">
            {pendingReports.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Нет новых жалоб
              </p>
            ) : (
              pendingReports.map((report) => {
                const content = reportedContent[report.id];
                const targetUserId = content?.post?.user_id || content?.thread?.user_id;
                const username = content?.post?.profiles?.username || content?.thread?.profiles?.username;

                return (
                  <div key={report.id} className="bg-card border border-border p-3 sm:p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          {safeDate(report.created_at).toLocaleString('ru-RU')}
                        </p>
                        <p className="font-bold mt-1 text-sm sm:text-base">Причина жалобы:</p>
                        <p className="text-xs sm:text-sm">{report.reason}</p>

                        {content ? (
                          <div className="mt-3 p-2 sm:p-3 bg-post-header border border-border">
                            <p className="text-xs text-muted-foreground mb-2">
                              Пользователь: {username || "Неизвестен"}
                            </p>
                            {content.thread && (
                              <>
                                <p className="font-bold mb-1 text-sm">{content.thread.title}</p>
                                <p className="text-xs sm:text-sm whitespace-pre-wrap break-words">
                                  {content.thread.content}
                                </p>
                                {content.thread.image_url && (
                                  <img 
                                    src={storageUrl("content", content.thread.image_url) || content.thread.image_url} 
                                    alt="Thread" 
                                    className="mt-2 max-w-full sm:max-w-xs max-h-48 border border-border"
                                  />
                                )}
                              </>
                            )}
                            {content.post && (
                              <>
                                <p className="text-xs sm:text-sm whitespace-pre-wrap break-words">
                                  {content.post.content}
                                </p>
                                {content.post.image_url && (
                                  <img 
                                    src={storageUrl("content", content.post.image_url) || content.post.image_url} 
                                    alt="Post" 
                                    className="mt-2 max-w-full sm:max-w-xs max-h-48 border border-border"
                                  />
                                )}
                              </>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-2">Контент удален или недоступен</p>
                        )}
                      </div>
                      <div className="flex sm:flex-col gap-2 flex-shrink-0">
                        {report.reported_thread_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const slug = window.location.pathname.split('/')[1] || 'b';
                              navigate(`/${slug}/thread/${report.reported_thread_id}`);
                            }}
                            className="text-xs"
                          >
                            Открыть
                          </Button>
                        )}
                      </div>
                    </div>

                    {selectedReport === report.id ? (
                      <div className="space-y-3 border-t border-border pt-3">
                        <Textarea
                          placeholder="Заметка модератора..."
                          value={moderatorNote}
                          onChange={(e) => setModeratorNote(e.target.value)}
                          rows={2}
                        />
                        
                        <div className="flex gap-2 flex-wrap text-xs sm:text-sm">
                          <Button
                            onClick={() => handleResolve(report.id, 'approve')}
                            variant="default"
                            size="sm"
                          >
                            Принять
                          </Button>
                          <Button
                            onClick={() => handleResolve(report.id, 'reject')}
                            variant="destructive"
                            size="sm"
                          >
                            Отклонить
                          </Button>
                          
                          {report.reported_post_id && (
                            <Button
                              onClick={() => handleDeletePost(report.reported_post_id!)}
                              variant="destructive"
                              size="sm"
                            >
                              Удалить пост
                            </Button>
                          )}
                          
                          {targetUserId && (
                            <>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    Предупредить
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="bg-background border-border">
                                  <DialogHeader>
                                    <DialogTitle>Отправить предупреждение</DialogTitle>
                                  </DialogHeader>
                                  <Textarea
                                    placeholder="Причина предупреждения..."
                                    value={warningReason}
                                    onChange={(e) => setWarningReason(e.target.value)}
                                    rows={3}
                                  />
                                  <Button onClick={() => handleSendWarning(targetUserId)}>
                                    Отправить
                                  </Button>
                                </DialogContent>
                              </Dialog>

                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="destructive" size="sm">
                                    Забанить
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="bg-background border-border">
                                  <DialogHeader>
                                    <DialogTitle>Забанить пользователя</DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-3">
                                    <Textarea
                                      placeholder="Причина бана..."
                                      value={banReason}
                                      onChange={(e) => setBanReason(e.target.value)}
                                      rows={3}
                                    />
                                    <Input
                                      type="number"
                                      placeholder="Дней"
                                      value={banDays}
                                      onChange={(e) => setBanDays(e.target.value)}
                                      min="1"
                                    />
                                    <div className="flex gap-2">
                                      <Button 
                                        onClick={() => handleBanUser(targetUserId, false)}
                                        variant="destructive"
                                      >
                                        Забанить на {banDays} дней
                                      </Button>
                                      <Button 
                                        onClick={() => handleBanUser(targetUserId, true)}
                                        variant="destructive"
                                      >
                                        Забанить навсегда
                                      </Button>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </>
                          )}
                          
                          <Button
                            onClick={() => {
                              setSelectedReport(null);
                              setModeratorNote("");
                            }}
                            variant="outline"
                            size="sm"
                          >
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        onClick={() => setSelectedReport(report.id)}
                        variant="secondary"
                        size="sm"
                      >
                        Обработать
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="resolved" className="space-y-4 mt-4">
            {resolvedReports.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Нет обработанных жалоб
              </p>
            ) : (
              resolvedReports.map((report) => (
                <div key={report.id} className="bg-card border border-border p-4 opacity-70">
                  <p className="text-sm text-muted-foreground">
                    {safeDate(report.created_at).toLocaleString('ru-RU')}
                  </p>
                  <p className="font-bold mt-1">Причина: {report.reason}</p>
                  <p className="text-sm text-primary mt-2">
                    Статус: {report.status === 'resolved' ? 'Принята' : 'Отклонена'}
                  </p>
                  {report.moderator_note && (
                    <p className="text-sm mt-1">
                      Заметка: {report.moderator_note}
                    </p>
                  )}
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Moderation;