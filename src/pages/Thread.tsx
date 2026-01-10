import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageUpload } from "@/components/ImageUpload";
import { ImageGallery } from "@/components/ImageGallery";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { AlertTriangle, Reply, Bell, BellOff, Send, ImagePlus } from "lucide-react";
import { ModeratorMenu } from "@/components/ModeratorMenu";
import { Input } from "@/components/ui/input";
import { TextFormattingToolbar } from "@/components/TextFormattingToolbar";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
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
  image_urls?: string[] | null;
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
  image_urls?: string[] | null;
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
  const [imageUrls, setImageUrls] = useState<string[]>([]);
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
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
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
    const loadAll = async () => {
      setPageLoading(true);
      await Promise.all([
        loadThread(),
        loadPosts(),
        checkSubscription(),
      ]);
      setPageLoading(false);
    };
    loadAll();
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
          
          // Parse image_urls if it's a JSON string, or create array from image_url
          let imageUrls: string[] = [];
          if (post.image_urls && Array.isArray(post.image_urls)) {
            imageUrls = post.image_urls;
          } else if (post.image_urls && typeof post.image_urls === 'string') {
            try {
              imageUrls = JSON.parse(post.image_urls);
            } catch {
              imageUrls = [];
            }
          } else if (post.image_url) {
            imageUrls = [post.image_url];
          }
          
          return {
            ...post,
            profiles: profile,
            imageUrls,
          };
        })
      );
      setPosts(postsWithProfiles);
      
      // Check for @AI mentions in new posts
      if (postsData.length > 0) {
        const latestPost = postsData[postsData.length - 1];
        if (latestPost.content.includes('@AI') && latestPost.reply_to) {
          await handleAIReply(latestPost);
        }
      }
    }
  };

  const handleAIReply = async (triggerPost: any) => {
    try {
      // Get the post that was replied to (this is the prompt)
      const { data: promptPost } = await supabase
        .from("posts")
        .select("content")
        .eq("id", triggerPost.reply_to)
        .single();

      if (!promptPost) return;

      console.log('[AI] Triggering AI reply to:', promptPost.content);
      
      // Show notification that AI is processing
      toast.info("🤖 AI генерирует ответ...", {
        duration: 3000,
      });

      // Call AI edge function
      const { error } = await supabase.functions.invoke('ai-reply', {
        body: {
          threadId: threadId,
          replyToId: triggerPost.reply_to,
          promptContent: promptPost.content
        }
      });

      if (error) {
        console.error('[AI] Error calling AI function:', error);
        toast.error("❌ Ошибка AI");
      } else {
        toast.success("✅ AI ответил");
      }
    } catch (error) {
      console.error('[AI] Error in handleAIReply:', error);
      toast.error("❌ Ошибка AI");
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

    // Convert array to JSON for storage, or use first image for backward compatibility
    const imageUrlForDb = imageUrls.length > 0 ? imageUrls[0] : null;
    const imageUrlsJson = imageUrls.length > 0 ? imageUrls : null;

    const { error } = await supabase.from("posts").insert({
      thread_id: threadId,
      user_id: user.id,
      content: content.trim(),
      image_url: imageUrlForDb, // Keep for backward compatibility
      image_urls: imageUrlsJson, // New field for multiple images
      reply_to: replyingTo,
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка отправки");
      return;
    }

    setContent("");
    setImageUrls([]);
    setReplyingTo(null);
    loadPosts();
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

  if (pageLoading || !thread) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const canPost = user && (!thread.boards.is_rules_board || isAdmin);

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1">
        <header className="bg-board-header text-board-header-foreground p-2 sm:p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="text-sm sm:text-base flex-1 min-w-0">
            <Link to="/" className="text-lg sm:text-xl font-bold hover:underline">
              gomo6
            </Link>
            <span className="mx-1 sm:mx-2 hidden sm:inline">/</span>
            <Link to={`/${slug}`} className="hover:underline hidden sm:inline">
              /{slug}/ - {thread.boards.name}
            </Link>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
                  <ProfileHoverCard userId={user.id}>
                    <Link to={`/profile/${user.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                    </Link>
                  </ProfileHoverCard>
                  {isModerator && (
                    <Link to="/moderation">
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                    </Link>
                  )}
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 sm:p-4 pb-40 sm:pb-44">
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
            {((thread as any).imageUrls && (thread as any).imageUrls.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {(thread as any).imageUrls.map((img: string, idx: number) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`Thread image ${idx + 1}`}
                    className="max-w-32 max-h-32 border border-border cursor-pointer rounded"
                    onClick={() => {
                      setGalleryImages((thread as any).imageUrls);
                      setGalleryIndex(idx);
                      setShowGallery(true);
                    }}
                  />
                ))}
              </div>
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
              {(post as any).imageUrls && (post as any).imageUrls.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {(post as any).imageUrls.map((img: string, idx: number) => (
                    <img
                      key={idx}
                      src={img}
                      alt={`Post image ${idx + 1}`}
                      className="max-w-32 max-h-32 border border-border cursor-pointer rounded"
                      onClick={() => {
                        setGalleryImages((post as any).imageUrls);
                        setGalleryIndex(idx);
                        setShowGallery(true);
                      }}
                    />
                  ))}
                </div>
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
          <div className="fixed bottom-4 left-0 right-0 z-50 px-4 max-w-full overflow-hidden">
            <div className="max-w-2xl mx-auto">
              <form 
                onSubmit={handleSubmitPost} 
                className="bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl p-3 space-y-2"
              >
                {replyingTo && (
                  <div className="flex items-center justify-between mb-1 text-xs text-muted-foreground">
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
                
                <TextFormattingToolbar onFormat={handleFormatText} />
                
                <div className="flex gap-2 items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-xl shrink-0"
                    onClick={() => {
                      // Trigger image upload
                      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                      input?.click();
                    }}
                  >
                    <ImagePlus className="h-5 w-5" />
                  </Button>
                  <div className="flex-1">
                    <Textarea
                      ref={textareaRef}
                      placeholder="Напишите сообщение…"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      disabled={loading}
                      autoExpand
                      maxRows={5}
                      className="bg-background/50 border-border/30"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading || (!content.trim() && imageUrls.length === 0)}
                    size="icon"
                    className="h-10 w-10 rounded-xl shrink-0"
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </div>

                <div className="mt-2">
                  <ImageUpload
                    onImagesUploaded={setImageUrls}
                    currentImages={imageUrls}
                  />
                </div>
              </form>
            </div>
          </div>
        ) : user ? (
          <div className="fixed bottom-4 left-0 right-0 z-50 px-4 max-w-full overflow-hidden">
            <div className="max-w-2xl mx-auto bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl p-4 text-center text-muted-foreground">
              На этой доске могут писать только администраторы
            </div>
          </div>
        ) : (
          <div className="fixed bottom-4 left-0 right-0 z-50 px-4 max-w-full overflow-hidden">
            <div className="max-w-2xl mx-auto bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">Войдите, чтобы ответить</p>
              <Button onClick={() => navigate("/auth")} size="sm">Войти</Button>
            </div>
          </div>
        )}
      </main>

        {/* Image Gallery */}
        {showGallery && (
          <ImageGallery
            images={galleryImages}
            initialIndex={galleryIndex}
            onClose={() => setShowGallery(false)}
          />
        )}
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};

export default Thread;
