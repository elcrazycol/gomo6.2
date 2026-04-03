import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
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
import { HeaderUsername } from "@/components/HeaderUsername";
import { AgeVerification } from "@/components/AgeVerification";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings } from "lucide-react";
import { LinkButton } from "@/components/LinkButton";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
import { renderPreviewContent } from "@/utils/emojiUtils.tsx";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";

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
    user_id: string | null;
    profiles: {
      username: string;
      is_anonymous: boolean;
    } | null;
  };
}

// Function to check if content contains visibility tags
const hasVisibilityTags = (content: string): boolean => {
  return content.includes('[seeusers=') || content.includes('[nousers=') || content.includes('[adm]');
};

const Board = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [showNewThread, setShowNewThread] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contentJson, setContentJson] = useState<unknown>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const editorRef = useRef<GomoRichEditorHandle>(null);
  
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

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", session.user.id);

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p);
              break;
            }
          }
        }
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

  useOnlineStatus(user?.id);

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
          
          // Get latest post with author info
          const { data: latestPost } = await supabase
            .from("posts")
            .select("content, created_at, is_private, user_id, profiles(username, is_anonymous)")
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
      content_json: contentJson,
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
    setContentJson(null);
    setImageUrls([]);
    setShowNewThread(false);
    loadThreads(board!.id);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  const renderContent = (text: string) => {
    return renderPreviewContent(text, 'board');
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
      <div className="flex-1 min-h-0">
        <header className="bg-board-header text-board-header-foreground p-2 sm:p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="text-sm sm:text-base flex-1 min-w-0">
            <Link to="/" className="relative text-lg sm:text-xl font-bold group">
              gomo6
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Link>
            <span className="mx-1 sm:mx-2 hidden sm:inline">/</span>
            <span className="relative text-base sm:text-lg hidden sm:inline group cursor-pointer" onClick={() => navigate(`/${slug}`)}>
              /{slug}/ - {board.name}
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </span>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group">
                <Settings className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
                  <HeaderUsername userId={user.id} />
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 sm:p-4 flex-1 relative">
        <div className="mb-3 sm:mb-4 text-center">
          <p className="text-sm sm:text-base text-muted-foreground">{board.description}</p>
        </div>

        {canCreateThread && !showNewThread && (
          <Button onClick={() => setShowNewThread(true)} className="mb-3 sm:mb-4 text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
            Создать тред
          </Button>
        )}

        {showNewThread && canCreateThread && (
          <form onSubmit={handleCreateThread} className="bg-post-header p-4 sm:p-5 border border-border mb-3 sm:mb-4 space-y-3">
            <h3 className="font-bold mb-2">Новый тред</h3>
            <Input
              placeholder="Тема"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mb-2"
              disabled={loading}
            />
            <GomoRichEditor
              ref={editorRef}
              contentJson={contentJson}
              legacyContent={content}
              onChange={({ json, text }) => {
                setContentJson(json);
                setContent(text);
              }}
              onSubmit={() => handleCreateThread({ preventDefault() {} } as React.FormEvent)}
              placeholder="Сообщение"
              minHeightClassName="min-h-[120px]"
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

        <div className="space-y-2 relative">
          {pageLoading ? (
            <>
              {/* Placeholder threads with blur */}
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={`placeholder-${i}`}
                  className="block border border-border bg-card p-2 sm:p-3 opacity-60 blur-sm pointer-events-none"
                >
                  <div className="flex gap-2 sm:gap-3">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-muted rounded border border-border flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="h-5 bg-muted rounded mb-2 w-3/4" />
                      <div className="h-3 bg-muted rounded mb-1 w-1/2" />
                      <div className="h-3 bg-muted rounded w-full mt-2" />
                      <div className="h-3 bg-muted rounded w-5/6 mt-1" />
                    </div>
                    <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                      <div className="h-4 bg-muted rounded w-12" />
                    </div>
                  </div>
                </div>
              ))}
              {/* Loader centered in viewport */}
              <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
                <PentagramLoader size="lg" />
              </div>
            </>
          ) : (
            threads.map((thread) => (
            <Link
              key={thread.id}
              to={`/${slug}/thread/${thread.id}`}
              className="block border border-border bg-card p-2 sm:p-3 hover:bg-thread-hover transition-all duration-200 group"
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
                  <h3 className="font-bold text-base sm:text-lg break-words relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                    {thread.title}
                    <span className="absolute bottom-1 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                  </h3>
                  <div className="text-xs text-muted-foreground mb-1">
                    <UserBadge
                      userId={thread.user_id}
                      username={thread.profiles?.username || "Аноним"}
                      isAnonymous={thread.profiles?.is_anonymous}
                      showOutline={false}
                      disableLink={true}
                    />
                    {" · "}
                    {formatDistanceToNow(new Date(thread.created_at), {
                      locale: ru,
                      addSuffix: true,
                    })}
                  </div>
                  {thread.latest_post ? (
                    <div className="mt-1">
                      {thread.latest_post.profiles && (
                        <div className="flex items-center gap-1 mb-1">
                          <UserBadge
                            userId={thread.latest_post.user_id}
                            username={thread.latest_post.profiles.username || "Аноним"}
                            isAnonymous={thread.latest_post.profiles.is_anonymous}
                            showOutline={false}
                          />
                        </div>
                      )}
                      <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 break-words">
                        {thread.latest_post.is_private ? 'Скрытый контент' :
                          hasVisibilityTags(thread.latest_post.content) ? 'зайдите в тему чтобы посмотреть' :
                          <>
                            {renderContent(thread.latest_post.content.substring(0, 100))}
                            {'...'}
                          </>
                        }
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-1 break-words">
                      {hasVisibilityTags(thread.content) ? 'зайдите в тему чтобы посмотреть' : (
                        <>
                          {renderContent(thread.content.substring(0, 100))}
                          {'...'}
                        </>
                      )}
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
            ))
          )}
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
