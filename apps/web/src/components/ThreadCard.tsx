import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { ProcessedContent } from "@/components/ProcessedContent";
import { Heart, MessageCircle, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/integrations/api/compat";

interface ThreadCardProps {
  thread: {
    id: string;
    title: string;
    content: string;
    content_json?: unknown;
    image_url: string | null;
    image_urls?: string[] | null;
    created_at: string;
    updated_at: string;
    user_id: string | null;
    tags?: Record<string, string>;
    ephemeral_type?: string | null;
    ephemeral_value?: number | null;
    auto_delete_at?: string | null;
    profiles: {
      username: string;
      display_name?: string | null;
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
  initialLikesCount?: number;
  initialUserLiked?: boolean;
  initialRecentLikers?: { username: string; display_name?: string | null; id: string; avatar_url: string | null; is_anonymous: boolean }[];
  initialRecentPost?: {
    id: string;
    content: string;
    content_json?: unknown;
    created_at: string;
    user_id: string | null;
    profiles: {
      username: string;
      display_name?: string | null;
      is_anonymous: boolean;
      avatar_url?: string | null;
    } | null;
  } | null;
}

export const renderTags = (tags: Record<string, string>, layout: 'inline' | 'block' | 'mobile' | 'board' = 'block', thread?: Record<string, unknown>) => {
  const containerClass = layout === 'inline'
    ? "flex flex-wrap gap-1"
    : layout === 'mobile'
    ? "flex flex-wrap gap-1 text-xs"
    : "flex flex-wrap gap-1 mt-1";

  return (
    <div className={containerClass}>
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
  initialLikesCount = 0,
  initialUserLiked = false,
  initialRecentLikers = [],
  initialRecentPost = null,
}: ThreadCardProps) => {
  const navigate = useNavigate();
  const [likesCount, setLikesCount] = useState(initialLikesCount);
  const [userLiked, setUserLiked] = useState(initialUserLiked);
  const [isExpanded, setIsExpanded] = useState(false);
  const [imagesExpanded, setImagesExpanded] = useState(false);
  const [hasOverflowImages, setHasOverflowImages] = useState(false);

  const lastPostDate = thread.updated_at && thread.updated_at !== thread.created_at
    ? thread.updated_at
    : null;

  useEffect(() => {
    setLikesCount(initialLikesCount);
    setUserLiked(initialUserLiked);
    setHasOverflowImages(false);
  }, [thread.id, initialLikesCount, initialUserLiked]);

  useEffect(() => {
    if (imagesExpanded) {
      setHasOverflowImages(false);
    }
  }, [imagesExpanded]);

  const handleLike = async () => {
    if (!currentUserId) return;
    if (thread.user_id === currentUserId) return;

    try {
      if (userLiked) {
        const { error } = await api
          .from("thread_likes")
          .delete()
          .eq("thread_id", thread.id)
          .eq("user_id", currentUserId);

        if (!error) {
          setUserLiked(false);
          setLikesCount(prev => prev - 1);
        }
      } else {
        const { error } = await api
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

  const boardPrefix = thread.boards?.is_gomosub ? "/g" : "";
  const boardSlug = thread.boards?.slug || "b";

  return (
    <article
      className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-all duration-200 cursor-pointer"
      onClick={() => navigate(`${boardPrefix}/${boardSlug}/thread/${thread.id}`)}
    >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
            {thread.profiles?.avatar_url ? (
              <img
                src={storageUrl("post-images", thread.profiles.avatar_url) || undefined}
                alt={thread.profiles.username || "Пользователь"}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-sm font-medium">
                {(thread.profiles?.username || "А").charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <UserBadge
                userId={thread.user_id}
                username={thread.profiles?.username || "Аноним"}
                displayName={thread.profiles?.display_name}
                isAnonymous={thread.profiles?.is_anonymous}
                showOutline={false}
                disableLink={false}
                stopPropagationOnClick={true}
              />
              <Link
                to={`${boardPrefix}/${boardSlug}`}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                в {boardPrefix || ""}/{boardSlug}/
              </Link>
              <span className={`text-xs text-muted-foreground ${hideTimestampOnCompactMobile ? "compact-mobile-hide" : ""}`}>
                {formatDistanceToNow(safeDate(thread.created_at), {
                  locale: ru,
                  addSuffix: true,
                })}
                {lastPostDate && (
                  <span className="hidden group-hover/title:inline">
                    {' | '}{formatDistanceToNow(safeDate(lastPostDate), {
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
              <div className="hidden md:inline ml-2">
                {renderTags(thread.tags, 'inline', thread)}
              </div>
            </h3>

            <div className="md:hidden">
              {renderTags(thread.tags, 'block', thread)}
            </div>
          </div>

        </div>

        <div className="mb-3">
          <div className={`text-sm break-words relative ${!isExpanded && thread.content.length > 300 ? 'max-h-20 overflow-hidden' : ''}`}>
            <ProcessedContent
              content={thread.content}
              contentJson={thread.content_json}
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

        {initialRecentPost && (
          <div className="border-t border-border pt-3">
            <div className="bg-muted/20 rounded p-3 text-xs ml-4 border-l-2 border-primary/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-xs">
                  {initialRecentPost.profiles?.username || "Аноним"}:
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDistanceToNow(safeDate(initialRecentPost.created_at), {
                    locale: ru,
                    addSuffix: true,
                  })}
                </span>
              </div>
              <div className="text-xs break-words line-clamp-3">
                {initialRecentPost.content.substring(0, 150)}
                {initialRecentPost.content.length > 150 && '...'}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
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
                    {initialRecentLikers.length > 0 ? (
                      initialRecentLikers.slice(0, 3).map((liker) => (
                        <div key={liker.id} className="flex items-center">
                          <UserBadge
                            userId={liker.id}
                            username={liker.is_anonymous ? "Аноним" : liker.username}
                            displayName={liker.is_anonymous ? undefined : liker.display_name}
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
                navigate(`${boardPrefix}/${boardSlug}/thread/${thread.id}`);
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
