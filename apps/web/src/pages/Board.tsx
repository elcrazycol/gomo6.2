import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate, useSearchParams, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

// Tag constants (duplicated from CreateThread.tsx for filtering)
const CONTENT_TAGS = [
  { value: 'anime', label: 'Аниме' },
  { value: 'games', label: 'Игры' },
  { value: 'music', label: 'Музыка' },
  { value: 'movies', label: 'Фильмы' },
  { value: 'comics', label: 'Комиксы' },
  { value: 'humor', label: 'Юмор' },
  { value: 'literature', label: 'Литература' },
  { value: 'stories', label: 'Истории' }
];

const FORMAT_TAGS = [
  { value: 'shitpost', label: 'Щитпост' },
  { value: 'discussion', label: 'Обсуждение' },
  { value: 'question', label: 'Вопрос' },
  { value: 'confession', label: 'Признание' },
  { value: 'story', label: 'Рассказ' },
  { value: 'guide', label: 'Гайд' }
];

const ATMOSPHERE_TAGS = [
  { value: 'serious', label: 'Серьёзно' },
  { value: 'irony', label: 'Ирония' },
  { value: 'vent', label: 'Выплеск' },
  { value: 'doom', label: 'Тьма' }
];

const FLAG_TAGS = [
  { value: 'normal', label: 'Обычный' },
  { value: 'ephemeral', label: 'Временный' },
  { value: 'night', label: 'Ночной' }
];
import { ImageUpload } from "@/components/ImageUpload";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { HeaderUsername } from "@/components/HeaderUsername";
import { AgeVerification } from "@/components/AgeVerification";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings, Filter, X, MessageCircle, ArrowUpRight, BookOpenText, UserPlus, UserCheck, Plus } from "lucide-react";
import { LinkButton } from "@/components/LinkButton";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";
import { renderPreviewContent } from "@/utils/emojiUtils.tsx";
import { renderTags } from "@/components/ThreadCard";
import { LikeButton } from "@/components/LikeButton";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_rules_board: boolean;
  is_gomosub?: boolean | null;
  cover_image_url?: string | null;
  gomosub_avatar_url?: string | null;
  owner_id?: string | null;
  rules_markdown?: string | null;
  rules_updated_at?: string | null;
  gomosub_tags?: string[] | null;
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
  tags?: any; // Thread tags object
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
  const location = useLocation();
  const isGomoRoute = location.pathname.startsWith("/g/");
  const pathPrefix = isGomoRoute ? "/g" : "";
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [authResolved, setAuthResolved] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [searchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [hasAcceptedRules, setHasAcceptedRules] = useState(false);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [checkingRules, setCheckingRules] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [membersCount, setMembersCount] = useState(0);
  const [membershipLoading, setMembershipLoading] = useState(false);
  
  useSessionTime(user?.id);

  // If the dynamic route caught the legacy gomosubs path, bounce to the dedicated page
  if (slug === "gomosubs") {
    return <Navigate to="/g" replace />;
  }

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      setAuthResolved(true);
      
      if (sessionUser) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", sessionUser.id);
        
        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", sessionUser.id)
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
          .eq("user_id", sessionUser.id);

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
        setAuthResolved(true);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useOnlineStatus(user?.id);

  useEffect(() => {
    const loadBoard = async () => {
      if (isGomoRoute && !authResolved) {
        setCheckingRules(true);
        return;
      }

      setPageLoading(true);
      setBoard(null);
      setThreads([]);
      setShowRulesDialog(false);
      setHasAcceptedRules(!isGomoRoute);
      setCheckingRules(isGomoRoute);

      const { data: boardData } = await supabase
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .eq("is_gomosub", isGomoRoute)
        .single();

      if (boardData) {
        setRulesConfirmed(false);

        if (boardData.is_gomosub && boardData.rules_markdown?.trim()) {
          setCheckingRules(true);
          const rulesVersion = boardData.rules_updated_at || "v1";
          let accepted = false;

          if (user?.id) {
            const { data: acceptance } = await supabase
              .from("gomosub_rules_acceptance")
              .select("accepted_at")
              .eq("user_id", user.id)
              .eq("board_id", boardData.id)
              .maybeSingle();

            if (acceptance?.accepted_at) {
              accepted = !boardData.rules_updated_at || new Date(acceptance.accepted_at) >= new Date(boardData.rules_updated_at);
            }
          } else {
            const storedVersion = localStorage.getItem(`gomosub-rules:${boardData.id}`);
            accepted = storedVersion === rulesVersion;
          }

          setHasAcceptedRules(accepted);
          setShowRulesDialog(!accepted);
          setCheckingRules(false);
        } else {
          setHasAcceptedRules(true);
          setShowRulesDialog(false);
          setCheckingRules(false);
        }

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
        setCheckingRules(false);
        setPageLoading(false);
      }
    };

    loadBoard();
  }, [slug, user, searchParams, isGomoRoute, authResolved]);

  useEffect(() => {
    const loadMembership = async () => {
      if (!board?.is_gomosub) {
        setIsJoined(false);
        setMembersCount(0);
        return;
      }

      const { count } = await supabase
        .from("gomosub_memberships")
        .select("*", { count: "exact", head: true })
        .eq("board_id", board.id);

      setMembersCount(count ?? 0);

      if (!user?.id) {
        setIsJoined(false);
        return;
      }

      const { data: membership } = await supabase
        .from("gomosub_memberships")
        .select("id")
        .eq("board_id", board.id)
        .eq("user_id", user.id)
        .maybeSingle();

      setIsJoined(Boolean(membership));
    };

    loadMembership();
  }, [board?.id, board?.is_gomosub, user?.id]);

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
    const contentFilter = searchParams.get('content');
    const formatFilter = searchParams.get('format');
    const atmosphereFilter = searchParams.get('atmosphere');
    const flagFilter = searchParams.get('flag');

    let query = supabase
      .from("threads")
      .select("*")
      .eq("board_id", boardId);

    if (!isGomoRoute) {
      // Filter by new tag system
      if (contentFilter) {
        query = query.eq("tags->>content", contentFilter);
      }
      if (formatFilter) {
        query = query.eq("tags->>format", formatFilter);
      }
      if (atmosphereFilter) {
        query = query.eq("tags->>atmosphere", atmosphereFilter);
      }
      if (flagFilter) {
        query = query.eq("tags->>flag", flagFilter);
      }

      // Backward compatibility: filter by old tag field if no new filters
      if (!contentFilter && !formatFilter && !atmosphereFilter && !flagFilter) {
        const oldTagFilter = searchParams.get('tag');
        if (oldTagFilter) {
          query = query.or(`tag.eq.${oldTagFilter},tags->>content.eq.${oldTagFilter}`);
        }
      }
    }

    const { data: threadsData } = await query.order("updated_at", { ascending: false });

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
            .select("content, created_at, is_private, user_id")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          // Get profile for latest post if it exists
          let latestPostWithProfile = latestPost;
          if (latestPost && latestPost.user_id) {
            const { data: postProfile } = await supabase
              .from("profiles")
              .select("username, is_anonymous")
              .eq("id", latestPost.user_id)
              .maybeSingle();

            latestPostWithProfile = {
              ...latestPost,
              profiles: postProfile
            };
          }

          return {
            ...thread,
            profiles: profile,
            latest_post: latestPostWithProfile,
          };
        })
      );
      setThreads(threadsWithData);
    }
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

  const rulesUpdatedLabel = board?.rules_updated_at
    ? formatDistanceToNow(new Date(board.rules_updated_at), { addSuffix: true, locale: ru })
    : null;

  const handleAcceptRules = async () => {
    if (!board?.is_gomosub || !board.rules_markdown?.trim()) {
      setShowRulesDialog(false);
      return;
    }

    if (!rulesConfirmed) {
      toast.error("Подтверди, что прочитал правила");
      return;
    }

    const rulesVersion = board.rules_updated_at || "v1";

    if (user?.id) {
      const { error } = await supabase
        .from("gomosub_rules_acceptance")
        .upsert(
          {
            user_id: user.id,
            board_id: board.id,
            accepted_at: new Date().toISOString(),
          },
          { onConflict: "user_id,board_id" }
        );

      if (error) {
        toast.error("Не удалось сохранить согласие с правилами");
        return;
      }
    } else {
      localStorage.setItem(`gomosub-rules:${board.id}`, rulesVersion);
    }

    setHasAcceptedRules(true);
    setShowRulesDialog(false);
    toast.success("Правила приняты");
  };

  const handleToggleJoin = async () => {
    if (!board?.is_gomosub) return;
    if (!user?.id) {
      toast.error("Войди в аккаунт, чтобы вступить");
      navigate("/auth");
      return;
    }
    if (membershipLoading) return;

    if (board.rules_markdown?.trim() && !hasAcceptedRules) {
      setShowRulesDialog(true);
      toast.error("Сначала прими правила саба");
      return;
    }

    setMembershipLoading(true);
    if (isJoined) {
      const { error } = await supabase
        .from("gomosub_memberships")
        .delete()
        .eq("board_id", board.id)
        .eq("user_id", user.id);

      setMembershipLoading(false);
      if (error) {
        toast.error("Не удалось выйти из саба");
        return;
      }
      setIsJoined(false);
      setMembersCount((prev) => Math.max(0, prev - 1));
      toast.success("Вы вышли из саба");
      return;
    }

    const { error } = await supabase
      .from("gomosub_memberships")
      .insert({ board_id: board.id, user_id: user.id });

    setMembershipLoading(false);
    if (error) {
      toast.error("Не удалось вступить в саб");
      return;
    }
    setIsJoined(true);
    setMembersCount((prev) => prev + 1);
    toast.success("Вы вступили в саб");
  };

  // Don't show fullscreen loader - let the content loader handle it
  if (!board || checkingRules) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }
  
  if (board.slug === 'd' && !ageVerified && !isGomoRoute) {
    return (
      <AgeVerification 
        open={showAgeVerification}
        onConfirm={handleAgeConfirm}
        onDecline={handleAgeDecline}
      />
    );
  }

  const canCreateThread = user && (!board.is_rules_board || isModerator) && (!board.is_gomosub || hasAcceptedRules);
  const hasSecondaryActions = Boolean(
    (isGomoRoute && board.rules_markdown?.trim()) ||
    (isGomoRoute && user?.id && board?.owner_id === user.id)
  );

  return (
    <main className={`${isGomoRoute ? "max-w-5xl" : "max-w-5xl"} mx-auto p-2 sm:p-4 md:p-5 flex-1 relative`}>
        <div className="mb-3 sm:mb-4 space-y-3">
          {board.is_gomosub ? (
            <Card className="overflow-hidden border-primary/20 bg-card">
              <div className="relative">
                <div className="h-40 sm:h-52">
                  {board.cover_image_url ? (
                    <img
                      src={board.cover_image_url}
                      alt={`Обложка /${board.slug}/`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-primary/15 to-muted" />
                  )}
                </div>
                <div className="absolute left-0 right-0 -bottom-10 sm:-bottom-12">
                  <div className="flex items-end gap-3 px-4 sm:px-6 py-2">
                    <div className="flex items-end gap-3 min-w-0">
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg border-2 border-background bg-muted overflow-hidden flex items-center justify-center text-2xl font-bold text-muted-foreground shrink-0">
                        {board.gomosub_avatar_url ? (
                          <img src={board.gomosub_avatar_url} alt={board.name} className="w-full h-full object-cover" />
                        ) : (
                          <span>{(board.name?.[0] || "g").toUpperCase()}</span>
                        )}
                      </div>
                      <div className="text-xl sm:text-2xl font-bold text-primary pb-1 truncate">g/{board.slug}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative px-4 sm:px-6 pt-12 sm:pt-14 pb-4 sm:pb-5">
                {board.is_gomosub && (
                  <div className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2">
                    <Button
                      variant={isJoined ? "secondary" : "default"}
                      onClick={handleToggleJoin}
                      className={`h-9 w-9 p-0 sm:h-10 sm:w-auto sm:px-4 sm:text-sm ${isJoined ? "bg-primary/12 text-primary hover:bg-primary/20 border border-primary/35" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                      disabled={membershipLoading || checkingRules}
                    >
                      {isJoined ? (
                        <>
                          <UserCheck className="w-4 h-4 sm:mr-2" />
                          <span className="hidden sm:inline">Вы участник</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4 sm:mr-2" />
                          <span className="hidden sm:inline">Вступить</span>
                        </>
                      )}
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-sm sm:text-base text-muted-foreground sm:pr-44">{board.description}</p>
              </div>
            </Card>
          ) : (
            <div className="text-center">
              <p className="text-sm sm:text-base text-muted-foreground">{board.description}</p>
            </div>
          )}

          {!isGomoRoute && (
          <>
          {/* Mobile Filters Button */}
          <div className="md:hidden mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 mx-auto"
            >
              <Filter className="w-4 h-4" />
              Фильтры
              {(searchParams.get('content') || searchParams.get('format') || searchParams.get('atmosphere') || searchParams.get('flag')) && (
                <Badge variant="secondary" className="ml-1">
                  {[searchParams.get('content'), searchParams.get('format'), searchParams.get('atmosphere'), searchParams.get('flag')].filter(Boolean).length}
                </Badge>
              )}
            </Button>

            {showFilters && (
              <Card className="mt-3 p-4 mx-auto max-w-md">
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">Фильтры</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowFilters(false)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Content filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Тема:</label>
                    <div className="flex flex-wrap gap-1">
                      {CONTENT_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('content') === tag.value) {
                              params.delete('content');
                            } else {
                              params.set('content', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('content') === tag.value
                              ? 'bg-blue-500/20 text-blue-700 border-blue-500/40'
                              : 'bg-background hover:bg-blue-500/10 border-border hover:border-blue-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Формат:</label>
                    <div className="flex flex-wrap gap-1">
                      {FORMAT_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('format') === tag.value) {
                              params.delete('format');
                            } else {
                              params.set('format', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('format') === tag.value
                              ? 'bg-green-500/20 text-green-700 border-green-500/40'
                              : 'bg-background hover:bg-green-500/10 border-border hover:border-green-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Atmosphere filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Атмосфера:</label>
                    <div className="flex flex-wrap gap-1">
                      {ATMOSPHERE_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('atmosphere') === tag.value) {
                              params.delete('atmosphere');
                            } else {
                              params.set('atmosphere', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('atmosphere') === tag.value
                              ? 'bg-purple-500/20 text-purple-700 border-purple-500/40'
                              : 'bg-background hover:bg-purple-500/10 border-border hover:border-purple-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Flag filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Тип:</label>
                    <div className="flex flex-wrap gap-1">
                      {FLAG_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('flag') === tag.value) {
                              params.delete('flag');
                            } else {
                              params.set('flag', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('flag') === tag.value
                              ? 'bg-orange-500/20 text-orange-700 border-orange-500/40'
                              : 'bg-background hover:bg-orange-500/10 border-border hover:border-orange-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Desktop filters - keep original style */}
          <div className="hidden md:block mt-3">
            <div className="flex flex-wrap justify-center gap-1 max-w-4xl mx-auto">
              {/* Content filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">Тема:</span>
                {CONTENT_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('content') === tag.value) {
                        params.delete('content');
                      } else {
                        params.set('content', tag.value);
                      }
                      navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('content') === tag.value
                        ? 'bg-blue-500/20 text-blue-700 border-blue-500/40'
                        : 'bg-background hover:bg-blue-500/10 border-border hover:border-blue-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Format filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">Формат:</span>
                {FORMAT_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('format') === tag.value) {
                        params.delete('format');
                      } else {
                        params.set('format', tag.value);
                      }
                      navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('format') === tag.value
                        ? 'bg-green-500/20 text-green-700 border-green-500/40'
                        : 'bg-background hover:bg-green-500/10 border-border hover:border-green-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Atmosphere filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">Атмосфера:</span>
                {ATMOSPHERE_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('atmosphere') === tag.value) {
                        params.delete('atmosphere');
                      } else {
                        params.set('atmosphere', tag.value);
                      }
                      navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('atmosphere') === tag.value
                        ? 'bg-purple-500/20 text-purple-700 border-purple-500/40'
                        : 'bg-background hover:bg-purple-500/10 border-border hover:border-purple-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Flag filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">Тип:</span>
                {FLAG_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('flag') === tag.value) {
                        params.delete('flag');
                      } else {
                        params.set('flag', tag.value);
                      }
                        navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('flag') === tag.value
                        ? 'bg-orange-500/20 text-orange-700 border-orange-500/40'
                        : 'bg-background hover:bg-orange-500/10 border-border hover:border-orange-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {(searchParams.get('content') || searchParams.get('format') || searchParams.get('atmosphere') || searchParams.get('flag') || searchParams.get('tag')) && (
            <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Фильтр:</span>

              {searchParams.get('content') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full border border-blue-500/20">
                  {searchParams.get('content') === 'anime' && 'Аниме'}
                  {searchParams.get('content') === 'games' && 'Игры'}
                  {searchParams.get('content') === 'music' && 'Музыка'}
                  {searchParams.get('content') === 'movies' && 'Фильмы'}
                  {searchParams.get('content') === 'comics' && 'Комиксы'}
                  {searchParams.get('content') === 'humor' && 'Юмор'}
                  {searchParams.get('content') === 'literature' && 'Литература'}
                  {searchParams.get('content') === 'stories' && 'Истории'}
                </span>
              )}

              {searchParams.get('format') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-green-500/10 text-green-600 rounded-full border border-green-500/20">
                  {searchParams.get('format') === 'shitpost' && 'Щитпост'}
                  {searchParams.get('format') === 'discussion' && 'Обсуждение'}
                  {searchParams.get('format') === 'question' && 'Вопрос'}
                  {searchParams.get('format') === 'confession' && 'Признание'}
                  {searchParams.get('format') === 'story' && 'Рассказ'}
                  {searchParams.get('format') === 'guide' && 'Гайд'}
                </span>
              )}

              {searchParams.get('atmosphere') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 rounded-full border border-purple-500/20">
                  {searchParams.get('atmosphere') === 'serious' && 'Серьёзно'}
                  {searchParams.get('atmosphere') === 'irony' && 'Ирония'}
                  {searchParams.get('atmosphere') === 'vent' && 'Выплеск'}
                  {searchParams.get('atmosphere') === 'doom' && 'Тьма'}
                </span>
              )}

              {searchParams.get('flag') && searchParams.get('flag') !== 'normal' && (
                <span className="inline-block px-2 py-0.5 text-xs bg-orange-500/10 text-orange-600 rounded-full border border-orange-500/20">
                  {searchParams.get('flag') === 'ephemeral' && 'Временный'}
                  {searchParams.get('flag') === 'night' && 'Ночной'}
                </span>
              )}

              {/* Backward compatibility for old tag system */}
              {searchParams.get('tag') && !searchParams.get('content') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full border border-primary/20">
                  {searchParams.get('tag') === 'anime' && '🎬 Аниме'}
                  {searchParams.get('tag') === 'games' && '🎮 Игры'}
                  {searchParams.get('tag') === 'music' && '🎵 Музыка'}
                  {searchParams.get('tag') === 'sports' && '⚽ Спорт'}
                  {searchParams.get('tag') === 'movies' && '🎥 Фильмы'}
                  {searchParams.get('tag') === 'comics' && '📚 Комиксы'}
                  {searchParams.get('tag') === 'humor' && '😂 Юмор'}
                  {searchParams.get('tag') === 'literature' && '📖 Литература'}
                  {searchParams.get('tag') === 'stories' && '📝 Истории'}
                </span>
              )}

              <button
                onClick={() => navigate(`/${board.slug}`)}
                className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
              >
                Сбросить
              </button>
            </div>
          )}
          </>
          )}
        </div>

        <div className="mb-3 sm:mb-4">
          <div className="flex items-center gap-2 sm:flex-row sm:items-center sm:justify-between">
            {canCreateThread && (
              <Button
                onClick={() =>
                  navigate(
                    isGomoRoute
                      ? `/g/${slug}/create`
                      : `/create?board=${slug}`
                  )
                }
                className="h-8 w-8 p-0 rounded-lg sm:h-10 sm:w-auto sm:px-4 sm:text-sm"
              >
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Создать тред</span>
              </Button>
            )}
            {hasSecondaryActions && (
              <div className="flex items-center gap-2 ml-auto">
                {isGomoRoute && board.rules_markdown?.trim() && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRulesDialog(true)}
                    className="h-8 px-3 text-xs sm:h-9 sm:text-sm rounded-lg border-primary/35 text-primary hover:bg-primary/10"
                    disabled={checkingRules}
                  >
                    <BookOpenText className="w-3.5 h-3.5 mr-1.5" />
                    Правила
                  </Button>
                )}
                {isGomoRoute && user?.id && board?.owner_id === user.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/g/${slug}/settings`)}
                    className="h-8 px-3 text-xs sm:h-9 sm:text-sm rounded-lg border-primary/35 text-primary hover:bg-primary/10"
                  >
                    Настройки
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>


        <div className="space-y-2 relative">
          {pageLoading ? (
            <>
              {/* Placeholder threads with blur */}
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={`placeholder-${i}`}
                  className="block border border-border bg-card p-2 sm:p-3 opacity-60 blur-sm pointer-events-none"
                >
                  <div className="relative flex items-start gap-3 min-h-[80px] sm:min-h-[100px]">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-muted rounded flex-shrink-0" />
                    <div className="flex-shrink-0 max-w-[200px] sm:max-w-[250px]">
                      <div className="h-5 bg-muted rounded mb-2 w-full" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                    <div className="absolute bottom-2 right-2">
                      <div className="h-3 bg-muted rounded w-8" />
                    </div>
                    <div className="absolute top-2 right-2">
                      <div className="w-6 h-6 bg-muted rounded-full" />
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
              isGomoRoute ? (
                <Card key={thread.id} className="border-border/70 bg-card/95 p-0 overflow-hidden hover:border-primary/35 transition-colors rounded-xl">
                  <div className="p-3 sm:p-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <UserBadge
                          userId={thread.user_id}
                          username={thread.profiles?.username || "Аноним"}
                          isAnonymous={thread.profiles?.is_anonymous}
                          showOutline={false}
                          disableLink={true}
                          className="text-sm"
                        />
                        <span>
                          {formatDistanceToNow(new Date(thread.created_at), {
                            locale: ru,
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <div className="h-px bg-border/35" />

                      <Link
                        to={`${pathPrefix}/${slug}/thread/${thread.id}`}
                        className="block group/title"
                      >
                        <h3 className="font-bold text-lg sm:text-[1.35rem] leading-tight break-words group-hover/title:text-primary transition-colors">
                          {thread.title}
                        </h3>
                      </Link>

                      {Array.isArray(thread.tags?.gomosub_tags) && thread.tags.gomosub_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {thread.tags.gomosub_tags.map((tag: string) => (
                            <span
                              key={`${thread.id}-g-${tag}`}
                              className="inline-block px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full border border-primary/20"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="relative">
                        <div
                          className={`text-sm sm:text-base text-foreground/90 whitespace-pre-wrap break-words leading-relaxed ${thread.content.length > 900 ? "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}`}
                        >
                          {hasVisibilityTags(thread.content)
                            ? 'зайдите в тему чтобы посмотреть'
                            : renderContent(thread.content)}
                        </div>
                        {thread.content.length > 900 && (
                          <Link
                            to={`${pathPrefix}/${slug}/thread/${thread.id}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 mt-2"
                          >
                            Читать полностью
                            <ArrowUpRight className="w-4 h-4" />
                          </Link>
                        )}
                      </div>

                      {thread.image_url && (
                        <Link to={`${pathPrefix}/${slug}/thread/${thread.id}`} className="block pt-1">
                          <img
                            src={thread.image_url}
                            alt="Thread"
                            className="max-w-[220px] sm:max-w-[280px] max-h-40 sm:max-h-48 object-cover rounded-md"
                          />
                        </Link>
                      )}

                      <div className="h-px bg-border/35 mt-1" />
                      <div className="pt-2 flex items-center justify-between text-sm text-muted-foreground">
                        <LikeButton
                          postId={thread.id}
                          currentUserId={user?.id ?? null}
                          postAuthorId={thread.user_id}
                          isThread={true}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => navigate(`${pathPrefix}/${slug}/thread/${thread.id}`)}
                          className="h-9 rounded-full px-3 gap-2"
                        >
                          <MessageCircle className="w-4 h-4" />
                          {thread.post_count > 0 ? thread.post_count : 0}
                        </Button>
                      </div>

                      {thread.latest_post?.content && (
                        <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-medium">Последний комментарий:</span>{" "}
                          {thread.latest_post.content.slice(0, 120)}
                          {thread.latest_post.content.length > 120 && "..."}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                <Link
                  key={thread.id}
                  to={`${pathPrefix}/${slug}/thread/${thread.id}`}
                  className="block border border-border bg-card p-2 sm:p-3 hover:bg-thread-hover transition-all duration-200 group"
                >
                  {/* Mobile Layout */}
                  <div className="md:hidden">
                    <div className="space-y-3">
                      {/* User info and time */}
                      <div className="flex items-center justify-between">
                        <UserBadge
                          userId={thread.user_id}
                          username={thread.profiles?.username || "Аноним"}
                          isAnonymous={thread.profiles?.is_anonymous}
                          showOutline={false}
                          disableLink={true}
                          className="text-sm"
                        />
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(thread.created_at), {
                            locale: ru,
                            addSuffix: true,
                          })}
                        </span>
                      </div>

                      {/* Thread Title */}
                      <h3 className="font-bold text-lg break-words">
                        {thread.title}
                      </h3>

                      {/* Tags */}
                      <div>
                        {renderTags(thread.tags, 'mobile')}
                      </div>

                      {/* Thread Content Preview */}
                      <div className="text-sm text-muted-foreground line-clamp-3 break-words">
                        {hasVisibilityTags(thread.content) ? 'зайдите в тему чтобы посмотреть' : (
                          <>
                            {renderContent(thread.content.substring(0, 200))}
                            {thread.content.length > 200 && '...'}
                          </>
                        )}
                      </div>

                      {/* Thread Image - Large and prominent at bottom */}
                      {thread.image_url && (
                        <div className="w-full">
                          <img
                            src={thread.image_url}
                            alt="Thread"
                            className="w-full h-48 object-cover border border-border rounded-lg"
                          />
                        </div>
                      )}

                      {/* Reply count */}
                      <div className="flex justify-end">
                        <span className="text-xs text-muted-foreground">
                          {thread.post_count > 0
                            ? `${thread.post_count} ${thread.post_count === 1 ? 'ответ' : 'ответов'}`
                            : 'нет ответов'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Desktop Layout */}
                  <div className="hidden md:block">
                    <div className="flex gap-4">
                      {/* Thread Image */}
                      <div className="flex-shrink-0">
                        {thread.image_url ? (
                          <img
                            src={thread.image_url}
                            alt="Thread"
                            className="w-24 h-24 object-cover border border-border rounded-lg"
                          />
                        ) : (
                          <div className="w-24 h-24 bg-muted border border-border rounded-lg flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">Нет фото</span>
                          </div>
                        )}
                      </div>

                      {/* Thread Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-bold text-lg break-words pr-4 transition-transform duration-200 group-hover:translate-x-0.5">
                            {thread.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm text-muted-foreground">
                              {thread.post_count > 0
                                ? `${thread.post_count} ${thread.post_count === 1 ? 'ответ' : 'ответов'}`
                                : 'нет ответов'}
                            </span>
                            <UserBadge
                              userId={thread.user_id}
                              username={thread.profiles?.username || "Аноним"}
                              isAnonymous={thread.profiles?.is_anonymous}
                              showOutline={false}
                              disableLink={true}
                              className="text-sm"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(thread.created_at), {
                              locale: ru,
                              addSuffix: true,
                            })}
                          </span>
                          <div className="flex-1">
                            {renderTags(thread.tags, 'inline')}
                          </div>
                        </div>

                        <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                          {hasVisibilityTags(thread.content) ? 'зайдите в тему чтобы посмотреть' : (
                            <>
                              {renderContent(thread.content.substring(0, 300))}
                              {thread.content.length > 300 && '...'}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              )
            ))
          )}
        </div>

        {threads.length === 0 && !pageLoading && (
          <div className="text-center text-muted-foreground p-8">
            Тредов пока нет. Будьте первым!
          </div>
        )}

        {board.is_gomosub && board.rules_markdown?.trim() && (
          <Dialog
            open={showRulesDialog}
            onOpenChange={(open) => {
              if (hasAcceptedRules) {
                setShowRulesDialog(open);
              } else if (open) {
                setShowRulesDialog(true);
              }
            }}
          >
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BookOpenText className="w-5 h-5 text-primary" />
                  Правила g/{board.slug}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {rulesUpdatedLabel && (
                  <p className="text-xs text-muted-foreground">Обновлены {rulesUpdatedLabel}</p>
                )}
                <div className="max-h-[46vh] overflow-y-auto rounded-md border border-border/70 bg-muted/30 p-3">
                  <div className="prose prose-sm max-w-none">
                    {renderContent(board.rules_markdown)}
                  </div>
                </div>
                {!hasAcceptedRules && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="g-rules-accepted"
                      checked={rulesConfirmed}
                      onCheckedChange={(checked) => setRulesConfirmed(Boolean(checked))}
                    />
                    <label htmlFor="g-rules-accepted" className="text-sm text-muted-foreground cursor-pointer">
                      Я прочитал правила и согласен соблюдать их
                    </label>
                  </div>
                )}
                <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                  {!hasAcceptedRules && (
                    <Button variant="outline" onClick={() => navigate("/g")}>
                      Вернуться к g-сабам
                    </Button>
                  )}
                  <Button onClick={hasAcceptedRules ? () => setShowRulesDialog(false) : handleAcceptRules}>
                    {hasAcceptedRules ? "Закрыть" : "Принять правила"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </main>
  );
};

export default Board;
