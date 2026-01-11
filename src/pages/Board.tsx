import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageUpload } from "@/components/ImageUpload";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { AgeVerification } from "@/components/AgeVerification";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings } from "lucide-react";
import { TextFormattingToolbar } from "@/components/TextFormattingToolbar";
import { useSessionTime } from "@/hooks/useSessionTime";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_rules_board: boolean;
}

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  post_count: number;
  user_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
  } | null;
  latest_post?: {
    content: string;
    created_at: string;
    is_private: boolean;
  };
}

const Board = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  
  useSessionTime(user?.id);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id);
        
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
    const loadBoard = async () => {
      setPageLoading(true);
      const { data: boardData } = await supabase
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .single();

      if (boardData) {
        setBoard(boardData);
        
        // Check age verification for /d/ board
        if (boardData.slug === 'd') {
          const verified = sessionStorage.getItem('age_verified_d');
          if (!verified) {
            setShowAgeVerification(true);
            setPageLoading(false);
          } else {
            setAgeVerified(true);
            await loadThreads(boardData.id);
            setPageLoading(false);
            
            // Award incel achievement
            if (user) {
              supabase.rpc("award_achievement", {
                _user_id: user.id,
                _achievement_id: "incel",
              });
            }
          }
        } else {
          await loadThreads(boardData.id);
          setPageLoading(false);
        }
      } else {
        setPageLoading(false);
      }
    };

    loadBoard();
  }, [slug, user]);

  useEffect(() => {
    if (!board) return;

    // Set up realtime subscription for new threads
    const channel = supabase
      .channel(`board-${board.id}-threads`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'threads',
          filter: `board_id=eq.${board.id}`,
        },
        () => {
          loadThreads(board.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [board]);

  const loadThreads = async (boardId: string) => {
    const { data: threadsData } = await supabase
      .from("threads")
      .select("*")
      .eq("board_id", boardId)
      .order("updated_at", { ascending: false });

    if (threadsData) {
      const threadsWithData = await Promise.all(
        threadsData.map(async (thread) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("username, is_anonymous")
            .eq("id", thread.user_id!)
            .maybeSingle();
          
          // Get latest post
          const { data: latestPost } = await supabase
            .from("posts")
            .select("content, created_at, is_private")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          return {
            ...thread,
            profiles: profile,
            latest_post: latestPost,
          };
        })
      );
      setThreads(threadsWithData);
    }
  };

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error("Нужно войти для создания треда");
      navigate("/auth");
      return;
    }

    if (!title.trim() || !content.trim()) {
      toast.error("Заполните все поля");
      return;
    }

    // Check if it's a rules board and user has permissions
    if (board?.is_rules_board && !isModerator) {
      toast.error("Только модераторы могут создавать треды здесь");
      return;
    }

    setLoading(true);

    // Convert array to JSON for storage, or use first image for backward compatibility
    const imageUrlForDb = imageUrls.length > 0 ? imageUrls[0] : null;
    const imageUrlsJson = imageUrls.length > 0 ? imageUrls : null;

    const { error } = await supabase.from("threads").insert({
      board_id: board!.id,
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
      image_url: imageUrlForDb, // Keep for backward compatibility
      image_urls: imageUrlsJson, // New field for multiple images
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка создания треда");
      return;
    }

    toast.success("Тред создан");
    setTitle("");
    setContent("");
    setImageUrls([]);
    setShowNewThread(false);
    loadThreads(board!.id);
  };

  const handleFormatText = (prefix: string, suffix: string) => {
    const textarea = contentTextareaRef.current;
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  const handleAgeConfirm = async () => {
    sessionStorage.setItem('age_verified_d', 'true');
    setShowAgeVerification(false);
    setAgeVerified(true);
    if (board) {
      loadThreads(board.id);
      
      // Award incel achievement
      if (user) {
        await supabase.rpc("award_achievement", {
          _user_id: user.id,
          _achievement_id: "incel",
        });
      }
    }
  };

  const handleAgeDecline = () => {
    navigate('/');
  };

  if (pageLoading || !board) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }
  
  if (board.slug === 'd' && !ageVerified) {
    return (
      <AgeVerification 
        open={showAgeVerification}
        onConfirm={handleAgeConfirm}
        onDecline={handleAgeDecline}
      />
    );
  }

  const canCreateThread = user && (!board.is_rules_board || isModerator);

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
            <span className="text-base sm:text-lg hidden sm:inline">/{slug}/ - {board.name}</span>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings">
              <Button variant="ghost" size="sm" className="p-2">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
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

      <main className="max-w-5xl mx-auto p-2 sm:p-4">
        <div className="mb-3 sm:mb-4 text-center">
          <p className="text-sm sm:text-base text-muted-foreground">{board.description}</p>
        </div>

        {canCreateThread && !showNewThread && (
          <Button onClick={() => setShowNewThread(true)} className="mb-3 sm:mb-4 text-sm">
            Создать тред
          </Button>
        )}

        {showNewThread && canCreateThread && (
          <form onSubmit={handleCreateThread} className="bg-post-header p-3 sm:p-4 border border-border mb-3 sm:mb-4">
            <h3 className="font-bold mb-2">Новый тред</h3>
            <Input
              placeholder="Тема"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mb-2"
              disabled={loading}
            />
            <TextFormattingToolbar onFormat={handleFormatText} />
            <Textarea
              ref={contentTextareaRef}
              placeholder="Сообщение"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                // Send on Enter only on desktop
                if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
              className="mb-2"
              rows={4}
              disabled={loading}
            />
            <ImageUpload
              onImagesUploaded={setImageUrls}
              currentImages={imageUrls}
            />
            <div className="flex gap-2 mt-3">
              <Button type="submit" disabled={loading}>
                {loading ? "Отправка..." : "Отправить"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewThread(false)}
                disabled={loading}
              >
                Отмена
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              to={`/${slug}/thread/${thread.id}`}
              className="block border border-border bg-card p-2 sm:p-3 hover:bg-thread-hover transition-colors"
            >
              <div className="flex gap-2 sm:gap-3">
                {thread.image_url && (
                  <img
                    src={thread.image_url}
                    alt="Thread"
                    className="w-16 h-16 sm:w-20 sm:h-20 object-cover border border-border flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-base sm:text-lg break-words">{thread.title}</h3>
                  <div className="text-xs text-muted-foreground mb-1">
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
                  {thread.latest_post ? (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-1 break-words">
                      Последний: {thread.latest_post.is_private ? 'Скрытый контент' : thread.latest_post.content.substring(0, 100) + '...'}
                    </p>
                  ) : (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-1 break-words">
                      {thread.content.substring(0, 100)}...
                    </p>
                  )}
                </div>
                <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                  <div className="font-bold whitespace-nowrap">
                    {thread.post_count > 0 
                      ? `${thread.post_count} ${thread.post_count === 1 ? 'отв.' : 'отв.'}`
                      : '0 отв.'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {threads.length === 0 && (
          <div className="text-center text-muted-foreground p-8">
            Тредов пока нет. Будьте первым!
          </div>
        )}
      </main>
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};

export default Board;
