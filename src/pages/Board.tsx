import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { HeaderUsername } from "@/components/HeaderUsername";
import { AgeVerification } from "@/components/AgeVerification";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings, Filter, X } from "lucide-react";
import { LinkButton } from "@/components/LinkButton";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";
import { renderPreviewContent } from "@/utils/emojiUtils.tsx";
import { renderTags } from "@/components/ThreadCard";

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
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [searchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  
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
  }, [slug, user, searchParams]);

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

  // Don't show fullscreen loader - let the content loader handle it
  if (!board) {
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
    <main className="max-w-5xl mx-auto p-2 sm:p-4 flex-1 relative">
        <div className="mb-3 sm:mb-4 text-center">
          <p className="text-sm sm:text-base text-muted-foreground">{board.description}</p>

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
        </div>

        {canCreateThread && (
          <Button onClick={() => navigate(`/create`)} className="mb-3 sm:mb-4 text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
            Создать тред
          </Button>
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
            <Link
              key={thread.id}
              to={`/${slug}/thread/${thread.id}`}
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
            ))
          )}
        </div>

        {threads.length === 0 && !pageLoading && (
          <div className="text-center text-muted-foreground p-8">
            Тредов пока нет. Будьте первым!
          </div>
        )}
      </main>
  );
};

export default Board;
