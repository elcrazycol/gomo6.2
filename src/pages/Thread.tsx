import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageUpload } from "@/components/ImageUpload";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { AlertTriangle, Reply, Bell, BellOff } from "lucide-react";
import { ModeratorMenu } from "@/components/ModeratorMenu";
import { Input } from "@/components/ui/input";
import { TextFormattingToolbar } from "@/components/TextFormattingToolbar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  created_at: string;
  user_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
  } | null;
  boards: {
    slug: string;
    name: string;
    is_rules_board: boolean;
  };
}

interface Post {
  id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  user_id: string | null;
  reply_to: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
  } | null;
}

const SpoilerText = ({ content }: { content: string }) => {
  const [revealed, setRevealed] = useState(false);
  
  return (
    <span
      onClick={() => setRevealed(!revealed)}
      className={`cursor-pointer transition-colors px-1 ${
        revealed
          ? "bg-transparent"
          : "bg-foreground text-foreground hover:bg-foreground/80"
      }`}
    >
      {revealed ? content : "████████"}
    </span>
  );
};

const Thread = () => {
  const { slug, threadId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportingPost, setReportingPost] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [banUserId, setBanUserId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState("7");
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id);
        
        setIsAdmin(roles?.some(r => r.role === 'admin') || false);
        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadThread();
    loadPosts();
    checkSubscription();
  }, [threadId, user]);

  const checkSubscription = async () => {
    if (!user || !threadId) return;
    
    const { data } = await supabase
      .from("thread_subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .eq("thread_id", threadId)
      .maybeSingle();
    
    setIsSubscribed(!!data);
  };

  const toggleSubscription = async () => {
    if (!user) {
      toast.error("Нужно войти");
      return;
    }

    if (isSubscribed) {
      const { error } = await supabase
        .from("thread_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("thread_id", threadId);
      
      if (!error) {
        setIsSubscribed(false);
        toast.success("Отписались от уведомлений");
      }
    } else {
      const { error } = await supabase
        .from("thread_subscriptions")
        .insert({ user_id: user.id, thread_id: threadId });
      
      if (!error) {
        setIsSubscribed(true);
        toast.success("Подписались на уведомления");
      }
    }
  };

  useEffect(() => {
    // Set up realtime subscription for new posts
    const channel = supabase
      .channel(`thread-${threadId}-posts`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadPosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  const loadThread = async () => {
    const { data: threadData } = await supabase
      .from("threads")
      .select("*")
      .eq("id", threadId)
      .single();

    if (threadData) {
      const { data: board } = await supabase
        .from("boards")
        .select("slug, name, is_rules_board")
        .eq("id", threadData.board_id)
        .single();

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, is_anonymous")
        .eq("id", threadData.user_id!)
        .maybeSingle();

      setThread({
        ...threadData,
        boards: board!,
        profiles: profile,
      });
    }
  };

  const loadPosts = async () => {
    const { data: postsData } = await supabase
      .from("posts")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (postsData) {
      const postsWithProfiles = await Promise.all(
        postsData.map(async (post) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("username, is_anonymous")
            .eq("id", post.user_id!)
            .maybeSingle();
          
          return {
            ...post,
            profiles: profile,
          };
        })
      );
      setPosts(postsWithProfiles);
    }
  };

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error("Нужно войти для ответа");
      navigate("/auth");
      return;
    }

    if (!content.trim()) {
      toast.error("Напишите что-нибудь");
      return;
    }

    // Check if only admin can post (rules board)
    if (thread?.boards.is_rules_board && !isAdmin) {
      toast.error("Только администраторы могут писать на этой доске");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("posts").insert({
      thread_id: threadId,
      user_id: user.id,
      content: content.trim(),
      image_url: imageUrl,
      reply_to: replyingTo,
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка отправки");
      return;
    }

    setContent("");
    setImageUrl(null);
    setReplyingTo(null);
  };

  const handleReport = async (postId: string | null, isThread: boolean) => {
    if (!user) {
      toast.error("Нужно войти для отправки жалоб");
      return;
    }

    if (!reportReason.trim()) {
      toast.error("Укажите причину жалобы");
      return;
    }

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_post_id: isThread ? null : postId,
      reported_thread_id: isThread ? threadId : null,
      reason: reportReason.trim(),
    });

    if (error) {
      toast.error("Ошибка отправки жалобы");
    } else {
      toast.success("Жалоба отправлена");
      setReportReason("");
      setReportingPost(null);
    }
  };

  const handleDeletePost = async (postId: string) => {
    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId);
    
    if (error) {
      toast.error("Ошибка удаления поста");
    } else {
      toast.success("Пост удален");
      loadPosts();
    }
  };

  const handleDeleteThread = async () => {
    const { error } = await supabase
      .from("threads")
      .delete()
      .eq("id", threadId);
    
    if (error) {
      toast.error("Ошибка удаления треда");
    } else {
      toast.success("Тред удален");
      navigate(`/${slug}`);
    }
  };

  const handleEditPost = async () => {
    if (!editContent.trim() || !editingPostId) return;

    const { error } = await supabase
      .from("posts")
      .update({ content: editContent.trim() })
      .eq("id", editingPostId);
    
    if (error) {
      toast.error("Ошибка изменения поста");
    } else {
      toast.success("Пост изменен");
      setEditingPostId(null);
      setEditContent("");
      loadPosts();
    }
  };

  const handleBanUser = async (isPermanent: boolean) => {
    if (!banReason.trim() || !banUserId) return;

    const expiresAt = isPermanent 
      ? null 
      : new Date(Date.now() + parseInt(banDays) * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("user_bans")
      .insert({
        user_id: banUserId,
        banned_by: user.id,
        reason: banReason.trim(),
        expires_at: expiresAt,
        is_permanent: isPermanent,
      });

    if (error) {
      toast.error("Ошибка выдачи бана");
    } else {
      toast.success(isPermanent ? "Пользователь забанен навсегда" : `Пользователь забанен на ${banDays} дней`);
      setBanUserId(null);
      setBanReason("");
    }
  };

  const handleFormatText = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText = 
      content.substring(0, start) + 
      prefix + 
      selectedText + 
      suffix + 
      content.substring(end);
    
    setContent(newText);
    
    // Restore cursor position after formatting
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const renderContent = (text: string) => {
    const elements: React.ReactNode[] = [];
    let currentIndex = 0;
    let key = 0;

    // Process spoilers first
    const spoilerRegex = /\|\|(.*?)\|\|/g;
    let match;
    let lastIndex = 0;

    const processTextSegment = (segment: string) => {
      // Process bold and italic
      return segment.split(/(\*\*.*?\*\*|\*.*?\*|@\w+)/g).map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={`${key++}-${i}`} className="font-bold">
              {part.slice(2, -2)}
            </strong>
          );
        } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return (
            <em key={`${key++}-${i}`} className="italic">
              {part.slice(1, -1)}
            </em>
          );
        } else if (part.startsWith('@')) {
          return (
            <span key={`${key++}-${i}`} className="text-link hover:underline cursor-pointer font-semibold">
              {part}
            </span>
          );
        }
        return part;
      });
    };

    while ((match = spoilerRegex.exec(text)) !== null) {
      // Add text before spoiler
      if (match.index > lastIndex) {
        elements.push(...processTextSegment(text.substring(lastIndex, match.index)));
      }

      // Add spoiler
      const spoilerContent = match[1];
      elements.push(
        <SpoilerText key={`spoiler-${key++}`} content={spoilerContent} />
      );

      lastIndex = spoilerRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      elements.push(...processTextSegment(text.substring(lastIndex)));
    }

    return elements;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  if (!thread) return <div className="p-4">Загрузка...</div>;

  const canPost = user && (!thread.boards.is_rules_board || isAdmin);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-2 sm:p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="text-sm sm:text-base">
            <Link to="/" className="text-lg sm:text-xl font-bold hover:underline">
              gomo6
            </Link>
            <span className="mx-1 sm:mx-2">/</span>
            <Link to={`/${slug}`} className="hover:underline">
              /{slug}/ - {thread.boards.name}
            </Link>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-wrap">
            {user && <NotificationBell userId={user.id} />}
            {user ? (
              <>
                <Link to={`/profile/${user.id}`}>
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                </Link>
                {isModerator && (
                  <Link to="/moderation">
                    <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                  </Link>
                )}
                <Button variant="secondary" size="sm" onClick={handleLogout} className="text-xs sm:text-sm">
                  Выйти
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 sm:p-4 pb-32 sm:pb-36">
        <div className="mb-4 flex justify-between items-center">
          <Link to={`/${slug}`} className="text-link hover:underline text-sm">
            ← Назад к доске
          </Link>
          {user && (
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSubscription}
            >
              {isSubscribed ? (
                <>
                  <BellOff className="h-4 w-4 mr-2" />
                  Отключить уведомления
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Уведомлять о новых постах
                </>
              )}
            </Button>
          )}
        </div>

        <div className="border border-border bg-card p-3 sm:p-4 mb-4">
          <div className="flex justify-between items-start mb-2 gap-2">
            <h1 className="text-xl sm:text-2xl font-bold break-words flex-1">{thread.title}</h1>
            <div className="flex gap-1 flex-shrink-0">
              {isModerator && thread.user_id && (
                <ModeratorMenu
                  type="thread"
                  onDelete={handleDeleteThread}
                  onBan={() => setBanUserId(thread.user_id!)}
                />
              )}
              {user && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <AlertTriangle className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-background border-border">
                    <DialogHeader>
                      <DialogTitle>Пожаловаться на тред</DialogTitle>
                    </DialogHeader>
                    <Textarea
                      placeholder="Причина жалобы..."
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      rows={3}
                    />
                    <Button onClick={() => handleReport(null, true)}>
                      Отправить жалобу
                    </Button>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
          
          <div className="bg-post-header p-2 sm:p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-2 flex-wrap">
              <span className="font-mono text-primary">#{thread.id.slice(0, 8)}</span>
              {" · "}
              <UserBadge
                userId={thread.user_id}
                username={thread.profiles?.username || "Аноним"}
                isAnonymous={thread.profiles?.is_anonymous}
              />
              {" · "}
              {formatDistanceToNow(new Date(thread.created_at), {
                locale: ru,
                addSuffix: true,
              })}
            </div>
            {thread.image_url && (
              <img
                src={thread.image_url}
                alt="Thread image"
                className={`mb-2 border border-border cursor-pointer transition-all ${
                  expandedImage === thread.image_url
                    ? "max-w-full max-h-full"
                    : "max-w-32 max-h-32"
                }`}
                onClick={() =>
                  setExpandedImage(
                    expandedImage === thread.image_url ? null : thread.image_url
                  )
                }
              />
            )}
            <p className="whitespace-pre-wrap text-sm sm:text-base break-words">
              {renderContent(thread.content)}
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {posts.map((post) => (
            <div
              key={post.id}
              id={`post-${post.id}`}
              className="bg-post-header p-2 sm:p-3 border border-border"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="text-xs text-muted-foreground mb-2 flex-wrap flex-1">
                  <span className="font-mono text-primary">#{post.id.slice(0, 8)}</span>
                  {" · "}
                  <UserBadge
                    userId={post.user_id}
                    username={post.profiles?.username || "Аноним"}
                    isAnonymous={post.profiles?.is_anonymous}
                  />
                  {" · "}
                  {formatDistanceToNow(new Date(post.created_at), {
                    locale: ru,
                    addSuffix: true,
                  })}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {isModerator && post.user_id && (
                    <ModeratorMenu
                      type="post"
                      onDelete={() => handleDeletePost(post.id)}
                      onEdit={() => {
                        setEditingPostId(post.id);
                        setEditContent(post.content);
                      }}
                      onBan={() => setBanUserId(post.user_id!)}
                    />
                  )}
                  {user && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplyingTo(post.id)}
                      >
                        <Reply className="h-4 w-4" />
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setReportingPost(post.id)}
                          >
                            <AlertTriangle className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-background border-border">
                          <DialogHeader>
                            <DialogTitle>Пожаловаться на пост</DialogTitle>
                          </DialogHeader>
                          <Textarea
                            placeholder="Причина жалобы..."
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            rows={3}
                          />
                          <Button onClick={() => handleReport(post.id, false)}>
                            Отправить жалобу
                          </Button>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                </div>
              </div>
              {post.reply_to && (
                <a
                  href={`#post-${post.reply_to}`}
                  className="text-xs text-link hover:underline block mb-1"
                >
                  → Ответ на #{post.reply_to.slice(0, 8)}
                </a>
              )}
              {post.image_url && (
                <img
                  src={post.image_url}
                  alt="Post image"
                  className={`mb-2 border border-border cursor-pointer transition-all ${
                    expandedImage === post.image_url
                      ? "max-w-full max-h-full"
                      : "max-w-32 max-h-32"
                  }`}
                  onClick={() =>
                    setExpandedImage(
                      expandedImage === post.image_url ? null : post.image_url
                    )
                  }
                />
              )}
              {editingPostId === post.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={4}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleEditPost} size="sm">Сохранить</Button>
                    <Button 
                      onClick={() => {
                        setEditingPostId(null);
                        setEditContent("");
                      }} 
                      variant="secondary" 
                      size="sm"
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm sm:text-base break-words">
                  {renderContent(post.content)}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Ban user dialog */}
        <Dialog open={!!banUserId} onOpenChange={(open) => !open && setBanUserId(null)}>
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
              <div className="flex gap-2 flex-wrap">
                <Button 
                  onClick={() => handleBanUser(false)}
                  variant="destructive"
                  size="sm"
                >
                  Забанить на {banDays} дней
                </Button>
                <Button 
                  onClick={() => handleBanUser(true)}
                  variant="destructive"
                  size="sm"
                >
                  Забанить навсегда
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {canPost ? (
          <form 
            onSubmit={handleSubmitPost} 
            className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg z-50 transition-all duration-300"
          >
            <div className="max-w-5xl mx-auto p-3 sm:p-4">
              {replyingTo && (
                <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
                  <span>Ответ на #{replyingTo.slice(0, 8)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplyingTo(null)}
                    className="h-6 text-xs"
                  >
                    ✕
                  </Button>
                </div>
              )}
              
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <TextFormattingToolbar onFormat={handleFormatText} />
                  <Textarea
                    ref={textareaRef}
                    placeholder="Напишите сообщение…"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={loading}
                    autoExpand
                    maxRows={5}
                    className="shadow-sm"
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={loading || !content.trim()} 
                  size="icon"
                  className="h-10 w-10 rounded-full flex-shrink-0"
                >
                  {loading ? "..." : "→"}
                </Button>
              </div>
              
              {imageUrl && (
                <div className="mt-2">
                  <ImageUpload
                    onImageUploaded={setImageUrl}
                    currentImage={imageUrl}
                    onRemove={() => setImageUrl(null)}
                  />
                </div>
              )}
              
              {!imageUrl && (
                <div className="mt-2">
                  <ImageUpload
                    onImageUploaded={setImageUrl}
                    currentImage={imageUrl}
                    onRemove={() => setImageUrl(null)}
                  />
                </div>
              )}
            </div>
          </form>
        ) : user ? (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border p-4 text-center z-50">
            <p className="text-sm text-muted-foreground">На этой доске могут писать только администраторы</p>
          </div>
        ) : (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border p-4 text-center z-50">
            <p className="text-sm text-muted-foreground mb-2">Войдите, чтобы ответить</p>
            <Button onClick={() => navigate("/auth")} size="sm">Войти</Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Thread;
