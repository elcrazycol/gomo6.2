import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { LikeButton } from "@/components/LikeButton";
import { Heart, MessageCircle, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThreadCardProps {
  thread: {
    id: string;
    title: string;
    content: string;
    image_url: string | null;
    image_urls?: string[] | null;
    created_at: string;
    updated_at: string;
    user_id: string | null;
    tags?: any; // Thread tags object
    ephemeral_type?: string | null;
    ephemeral_value?: number | null;
    auto_delete_at?: string | null;
    profiles: {
      username: string;
      is_anonymous: boolean;
      avatar_url?: string | null;
  } | null;
  boards: {
    slug: string;
    name: string;
    is_gomosub?: boolean | null;
  };
  post_count?: number;
  };
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  showPreview?: boolean;
  hideTimestampOnCompactMobile?: boolean;
}

interface RecentPost {
  id: string;
  content: string;
  created_at: string;
  user_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
}

export // Helper function to render tags
const renderTags = (tags: any, layout: 'inline' | 'block' | 'mobile' | 'board' = 'block', thread?: any) => {
  const containerClass = layout === 'inline'
    ? "flex flex-wrap gap-1"
    : layout === 'mobile'
    ? "flex flex-wrap gap-1 text-xs"
    : "flex flex-wrap gap-1 mt-1";

  return (
    <div className={containerClass}>
      {/* Ephemeral tag */}
      {thread?.ephemeral_type && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = `/b?flag=ephemeral`;
          }}
          className="inline-block px-2 py-0.5 text-xs bg-orange-500/10 text-orange-700 rounded-full
                   hover:bg-orange-500/20 hover:text-orange-800 transition-colors duration-200
                   border border-orange-500/20 hover:border-orange-500/40"
        >
          Временный
        </button>
      )}

      {/* Content tag */}
      {tags?.content && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = `/b?content=${tags.content}`;
          }}
          className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full
                   hover:bg-blue-500/20 hover:text-blue-700 transition-colors duration-200
                   border border-blue-500/20 hover:border-blue-500/40"
        >
          {tags.content === 'anime' && 'Аниме'}
          {tags.content === 'games' && 'Игры'}
          {tags.content === 'music' && 'Музыка'}
          {tags.content === 'movies' && 'Фильмы'}
          {tags.content === 'comics' && 'Комиксы'}
          {tags.content === 'humor' && 'Юмор'}
          {tags.content === 'literature' && 'Литература'}
          {tags.content === 'stories' && 'Истории'}
        </button>
      )}

      {/* Format tag */}
      {tags?.format && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = `/b?format=${tags.format}`;
          }}
          className="inline-block px-2 py-0.5 text-xs bg-green-500/10 text-green-600 rounded-full
                   hover:bg-green-500/20 hover:text-green-700 transition-colors duration-200
                   border border-green-500/20 hover:border-green-500/40"
        >
          {tags.format === 'shitpost' && 'Щитпост'}
          {tags.format === 'discussion' && 'Обсуждение'}
          {tags.format === 'question' && 'Вопрос'}
          {tags.format === 'confession' && 'Признание'}
          {tags.format === 'story' && 'Рассказ'}
          {tags.format === 'guide' && 'Гайд'}
        </button>
      )}

      {/* Atmosphere tag */}
      {tags?.atmosphere && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = `/b?atmosphere=${tags.atmosphere}`;
          }}
          className="inline-block px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 rounded-full
                   hover:bg-purple-500/20 hover:text-purple-700 transition-colors duration-200
                   border border-purple-500/20 hover:border-purple-500/40"
        >
          {tags.atmosphere === 'serious' && 'Серьёзно'}
          {tags.atmosphere === 'irony' && 'Ирония'}
          {tags.atmosphere === 'vent' && 'Выплеск'}
          {tags.atmosphere === 'doom' && 'Тьма'}
        </button>
      )}

      {/* Night tag */}
      {tags?.flag === 'night' && (
        <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full
               border border-blue-500/20">
          Ночной
        </span>
      )}
    </div>
  );
};

const ThreadCard = ({
  thread,
  currentUserId,
  currentUsername,
  currentUserColor,
  showPreview = true,
  hideTimestampOnCompactMobile = false,
}: ThreadCardProps) => {
  const navigate = useNavigate();
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
  const [likesCount, setLikesCount] = useState(0);
  const [userLiked, setUserLiked] = useState(false);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [imagesExpanded, setImagesExpanded] = useState(false);
  // Calculate last post date from thread updated_at if it's different from created_at
  const lastPostDate = thread.updated_at && thread.updated_at !== thread.created_at
    ? thread.updated_at
    : null;
  const [recentLikers, setRecentLikers] = useState<{username: string, id: string, avatar_url: string | null, is_anonymous: boolean}[]>([]);
  const [hasOverflowImages, setHasOverflowImages] = useState(false);

  useEffect(() => {
    loadRecentPosts();
    loadLikesData();
    // Reset overflow state when thread changes
    setHasOverflowImages(false);
  }, [thread.id]);

  useEffect(() => {
    // Reset overflow state when expanding images
    if (imagesExpanded) {
      setHasOverflowImages(false);
    }
  }, [imagesExpanded]);

  const loadRecentPosts = async () => {
    if (isLoadingPosts) return; // Prevent multiple simultaneous loads

    setIsLoadingPosts(true);
    try {
      // Get posts first
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select(`
          id,
          content,
          created_at,
          user_id
        `)
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: false })
        .limit(1); // Always load at least 1 post

      if (postsError || !postsData || postsData.length === 0) {
        setRecentPosts([]);
        return;
      }

      // Get profiles separately
      const userIds = postsData.map(post => post.user_id).filter(Boolean);
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, is_anonymous, avatar_url")
        .in("id", userIds);

      // Combine posts with profiles
      const postsWithProfiles = postsData.map(post => ({
        ...post,
        profiles: profilesData?.find(profile => profile.id === post.user_id) || null
      }));

      const data = postsWithProfiles;

      if (data && data.length > 0) {
        setRecentPosts(data.reverse()); // Reverse to show oldest first
      } else {
        setRecentPosts([]);
      }
    } catch (error) {
      console.error("Error loading recent posts:", error);
    } finally {
      setIsLoadingPosts(false);
    }
  };

  const loadLikesData = async () => {
    try {
      // Get likes count
      const { data: likesData, error: likesError } = await supabase.rpc(
        "get_thread_likes_count",
        { thread_uuid: thread.id }
      );

      if (!likesError && likesData !== null) {
        setLikesCount(likesData);
      }

      // Get recent likers for tooltip (always load, even if no likes yet)
      const { data: likersData, error: likersError } = await supabase.rpc(
        "get_recent_thread_likers",
        {
          thread_uuid: thread.id,
          limit_count: 3
        }
      );

      if (!likersError && likersData) {
        setRecentLikers(likersData);
      }

      // Check if current user liked this thread
      if (currentUserId) {
        const { data: likedData, error: likedError } = await supabase.rpc(
          "has_user_liked_thread",
          {
            thread_uuid: thread.id,
            user_uuid: currentUserId
          }
        );

        if (!likedError) {
          setUserLiked(likedData);
        }
      }
    } catch (error) {
      console.error("Error loading likes data:", error);
    }
  };

  const handleLike = async () => {
    if (!currentUserId) return;

    // Prevent liking your own thread
    if (thread.user_id === currentUserId) return;

    try {
      if (userLiked) {
        // Unlike
        const { error } = await supabase
          .from("thread_likes")
          .delete()
          .eq("thread_id", thread.id)
          .eq("user_id", currentUserId);

        if (!error) {
          setUserLiked(false);
          setLikesCount(prev => prev - 1);
        }
      } else {
        // Like
        const { error } = await supabase
          .from("thread_likes")
          .insert({
            thread_id: thread.id,
            user_id: currentUserId
          });

        if (!error) {
          setUserLiked(true);
          setLikesCount(prev => prev + 1);
        }
      }
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  const boardPrefix = thread.boards.is_gomosub ? "/g" : "";

  return (
    <article
      className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all duration-200 cursor-pointer"
      onClick={() => navigate(`${boardPrefix}/${thread.boards.slug}/thread/${thread.id}`)}
    >
        {/* Thread Header */}
        <div className="flex items-start gap-3 mb-3">
          {/* Author Avatar */}
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
            {thread.profiles?.avatar_url ? (
              <img
                src={thread.profiles.avatar_url}
                alt={thread.profiles.username || "Пользователь"}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-sm font-medium">
                {(thread.profiles?.username || "А").charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          {/* Thread Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <UserBadge
                userId={thread.user_id}
                username={thread.profiles?.username || "Аноним"}
                isAnonymous={thread.profiles?.is_anonymous}
                showOutline={false}
                disableLink={false}
                stopPropagationOnClick={true}
              />
              <Link
                to={`${boardPrefix}/${thread.boards.slug}`}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                в {boardPrefix || ""}/{thread.boards.slug}/
              </Link>
              <span className={`text-xs text-muted-foreground ${hideTimestampOnCompactMobile ? "compact-mobile-hide" : ""}`}>
                {formatDistanceToNow(new Date(thread.created_at), {
                  locale: ru,
                  addSuffix: true,
                })}
                {lastPostDate && (
                  <span className="hidden group-hover/title:inline">
                    {' | '}{formatDistanceToNow(new Date(lastPostDate), {
                      locale: ru,
                      addSuffix: true,
                    })}
                  </span>
                )}
              </span>
            </div>

            <h3 className="font-bold text-lg mb-2 break-words relative group/title">
              <span className="relative">
                {thread.title}
                {thread.ephemeral_type && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
                    {thread.ephemeral_type === 'time'
                      ? `${thread.ephemeral_value}ч`
                      : `${thread.ephemeral_value}сообщ.`
                    }
                  </span>
                )}
                {thread.tags?.flag === 'night' && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                    Ночной
                  </span>
                )}
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px]
                  bg-current transition-all duration-300
                  group-hover/title:w-full">
                </span>
              </span>
              {/* Desktop: inline tags */}
              <div className="hidden md:inline ml-2">
                {renderTags(thread.tags, 'inline', thread)}
              </div>
            </h3>

            {/* Mobile: tags below title */}
            <div className="md:hidden">
              {renderTags(thread.tags, 'block', thread)}
            </div>
          </div>

        </div>

        {/* Thread Content */}
        <div className="mb-3">
          <div className={`text-sm break-words relative ${!isExpanded && thread.content.length > 300 ? 'max-h-20 overflow-hidden' : ''}`}>
            <ProcessedContent
              content={thread.content}
              currentUserId={currentUserId}
              isAdmin={false}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
              postAuthorId={thread.user_id}
              authorUsername={thread.profiles?.username}
              showHiddenIndicators={false}
            />
            {!isExpanded && thread.content.length > 300 && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent flex items-end justify-center pb-1">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsExpanded(true);
                  }}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors bg-card/80 px-2 py-0.5 rounded"
                >
                  Раскрыть
                </button>
              </div>
            )}
          </div>

            {/* Images */}
            {thread.image_urls && thread.image_urls.length > 0 && (
            <div className="mt-3 relative">
              <div className={`grid grid-cols-2 gap-2 ${!imagesExpanded ? 'max-h-32 overflow-hidden' : ''}`}>
                {thread.image_urls.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`Изображение ${index + 1}`}
                    className={`w-full ${imagesExpanded ? 'h-auto max-h-96' : 'h-32'} object-cover object-top rounded border border-border`}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      // Check if image height exceeds container height (128px = 32 * 4px rem)
                      if (!imagesExpanded && img.naturalHeight > 128) {
                        setHasOverflowImages(true);
                      }
                    }}
                  />
                ))}
              </div>
              {!imagesExpanded && (
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent flex items-end justify-center pb-1">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setImagesExpanded(true);
                    }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors bg-card/80 px-2 py-0.5 rounded"
                  >
                    Раскрыть
                  </button>
                </div>
              )}
            </div>
            )}
        </div>

        {/* Last Post Preview */}
        {recentPosts.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="bg-muted/20 rounded p-3 text-xs ml-4 border-l-2 border-primary/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-xs">
                  {recentPosts[0].profiles?.username || "Аноним"}:
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDistanceToNow(new Date(recentPosts[0].created_at), {
                    locale: ru,
                    addSuffix: true,
                  })}
                </span>
              </div>
              <div className="text-xs break-words line-clamp-3">
                <ProcessedContent
                  content={recentPosts[0].content}
                  currentUserId={currentUserId}
                  isAdmin={false}
                  currentUsername={currentUsername}
                  currentUserColor={currentUserColor}
                  postAuthorId={recentPosts[0].user_id}
                  authorUsername={recentPosts[0].profiles?.username}
                  showHiddenIndicators={false}
                />
              </div>
            </div>
          </div>
        )}

        {/* Thread Stats */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            {/* Like button in left corner */}
            <div className="relative group/likes">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleLike();
                }}
                className={`p-1 h-auto flex items-center gap-1 !bg-transparent hover:!bg-transparent ${
                  userLiked
                    ? 'text-primary hover:text-primary/80'
                    : 'text-muted-foreground hover:text-primary'
                }`}
                disabled={!currentUserId}
              >
                <Heart className={`h-4 w-4 transition-all duration-200 ${
                  userLiked
                    ? 'fill-current'
                    : 'hover:stroke-primary hover:stroke-2'
                }`} />
                <span className="text-xs">{likesCount}</span>
              </Button>

              {/* Tooltip with recent likers */}
              <div className="
                absolute bottom-full left-1/2 -translate-x-1/2
                opacity-0 pointer-events-none
                transition-opacity duration-200
                group-hover/likes:opacity-100
              ">
                <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-lg whitespace-nowrap">
                  <div className="text-muted-foreground mb-2">
                    {likesCount > 3 ? `+${likesCount - 3} других` : `${likesCount} лайков`}
                  </div>
                  <div className="space-y-2">
                    {recentLikers.length > 0 ? (
                      recentLikers.slice(0, 3).map((liker) => (
                        <div key={liker.id} className="flex items-center">
                          <UserBadge
                            userId={liker.id}
                            username={liker.is_anonymous ? "Аноним" : liker.username}
                            isAnonymous={liker.is_anonymous}
                            showOutline={false}
                            className="text-xs"
                          />
                        </div>
                      ))
                    ) : (
                      <div className="text-muted-foreground text-xs">Пока нет лайков</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          <div className="text-xs text-muted-foreground">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(`${boardPrefix}/${thread.boards.slug}/thread/${thread.id}`);
              }}
              className="
                flex items-center gap-1
                text-xs text-muted-foreground
                hover:text-primary
                transition-colors
                group/replies
              "
            >
              <MessageCircle className="h-3 w-3" />
              {thread.post_count || 0}{' '}
              <span className="relative">
                ответов
                <span className="
                  absolute bottom-0 left-0 w-0 h-[1.5px]
                  bg-current transition-all duration-300
                  group-hover/replies:w-full
                " />
              </span>
            </button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Eye className="h-3 w-3" />
          <span>{thread.updated_at !== thread.created_at ? "Активен" : "Новый"}</span>
        </div>
      </div>
    </article>
  );
};

export { ThreadCard };
