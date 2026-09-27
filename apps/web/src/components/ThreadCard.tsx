import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, Share2 } from "lucide-react";

import { api } from "@/integrations/api/compat";
import { UserBadge } from "@/components/UserBadge";
import { storageUrl } from "@/utils/storage";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import {
  PostCardShell,
  PostCardHeader,
  PostCardHeading,
  PostCardActions,
  PostSourceChip,
} from "@/components/post/PostCardChrome";
import { SectionIcon } from "@/components/topic/sectionIcons";
import { buildThreadAttachments } from "@/utils/threadAttachments";
import { formatShortRelativeTime } from "@/utils/relativeTimeShort";

interface ThreadCardProps {
  thread: {
    id: string;
    title: string;
    content: string;
    content_json?: unknown;
    image_url: string | null;
    image_urls?: string[] | null;
    attachments?: unknown;
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
      nickname_emoji_id?: string | null;
      is_anonymous: boolean;
      avatar_url?: string | null;
    } | null;
    boards: {
      slug: string;
      name: string;
      is_gomosub?: boolean | null;
    };
    section?: {
      id: string;
      slug: string;
      name: string;
      icon?: string | null;
      is_nsfw?: boolean;
    } | null;
    subsection?: {
      id: string;
      slug: string;
      name: string;
    } | null;
    post_count?: number;
  };
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  showPreview?: boolean;
  hideTimestampOnCompactMobile?: boolean;
  initialLikesCount?: number;
  initialUserLiked?: boolean;
  initialRecentLikers?: { username: string; display_name?: string | null; nickname_emoji_id?: string | null; id: string; avatar_url: string | null; is_anonymous: boolean }[];
  initialRecentPost?: {
    id: string;
    content: string;
    content_json?: unknown;
    created_at: string;
    user_id: string | null;
    profiles: {
      username: string;
      display_name?: string | null;
      nickname_emoji_id?: string | null;
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

/**
 * Thread card for board/profile listings, in the same design language as the
 * feed wall card: compact header (avatar + author + source chip + short time),
 * themed title/tags, and the icon-only action row. Long content keeps its
 * "Раскрыть" affordance and the hover tooltip with recent likers; legacy photo
 * threads keep the inline expand grid, while rich-attachment threads render
 * through the shared progressive gallery.
 */
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
  const [shareOpen, setShareOpen] = useState(false);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Rich attachments (new composer) render through the shared gallery; legacy
  // threads keep their plain image_url grid + "Раскрыть" behaviour.
  const richAttachments = useMemo(() => buildThreadAttachments(thread), [thread]);
  const hasRichAttachments = useMemo(
    () => Array.isArray(thread.attachments) || typeof thread.attachments === "string",
    [thread.attachments],
  );
  const legacyImages = Array.isArray(thread.image_urls) ? thread.image_urls : [];

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
  const boardSlug = thread.boards?.slug || "";
  const threadPath = boardSlug
    ? `${boardPrefix}/${boardSlug}/thread/${thread.id}`
    : `/thread/${thread.id}`;

  const sourceChip = thread.section ? (
    <PostSourceChip
      icon={<SectionIcon name={thread.section.icon} className="h-3.5 w-3.5 shrink-0 text-primary" />}
      label={thread.subsection ? `${thread.section.name} · ${thread.subsection.name}` : thread.section.name}
    />
  ) : boardSlug ? (
    <PostSourceChip to={`${boardPrefix}/${boardSlug}`} label={`в ${boardPrefix || ""}/${boardSlug}/`} />
  ) : null;

  return (
    <>
    <PostCardShell onOpen={() => navigate(threadPath)}>
      <PostCardHeading>
        <PostCardHeader
          userId={thread.user_id}
          username={thread.profiles?.username || "Аноним"}
          displayName={thread.profiles?.display_name}
          emojiId={thread.profiles?.nickname_emoji_id}
          isAnonymous={thread.profiles?.is_anonymous}
          avatarUrl={thread.profiles?.avatar_url}
          createdAt={thread.created_at}
          hideTimestampOnCompactMobile={hideTimestampOnCompactMobile}
          chips={sourceChip}
        />

        <h3 className="break-words text-base font-semibold leading-6 sm:text-[17px] sm:leading-7">
          {thread.title}
          {thread.ephemeral_type && (
            <span className="ml-2 inline-flex items-center rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-medium text-orange-700">
              {thread.ephemeral_type === 'time'
                ? `${thread.ephemeral_value}ч`
                : `${thread.ephemeral_value}сообщ.`
              }
            </span>
          )}
          {thread.tags?.flag === 'night' && (
            <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600">
              Ночной
            </span>
          )}
        </h3>

        {thread.tags && Object.keys(thread.tags).length > 0 &&
          renderTags(thread.tags, 'inline', thread)}
      </PostCardHeading>

      <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
        <div className={`relative ${!isExpanded && thread.content.length > 300 ? 'max-h-20 overflow-hidden' : ''}`}>
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
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center bg-gradient-to-t from-background to-transparent pb-1 h-8">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsExpanded(true);
                }}
                className="rounded bg-background/80 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                Раскрыть
              </button>
            </div>
          )}
        </div>
      </div>

      {hasRichAttachments && richAttachments.length > 0 ? (
        <WallAttachments
          attachments={richAttachments}
          galleryKey={`thread-card-${thread.id}`}
          onImageClick={(items, idx) => {
            setGalleryItems(items);
            setGalleryIndex(idx);
          }}
        />
      ) : legacyImages.length > 0 ? (
        <div className="relative">
          <div className={`grid grid-cols-2 gap-2 ${!imagesExpanded ? 'max-h-32 overflow-hidden' : ''}`}>
            {legacyImages.map((url, index) => (
              <img
                key={index}
                src={storageUrl("content", url) || url}
                alt={`Изображение ${index + 1}`}
                className={`w-full rounded-md border border-border/70 ${imagesExpanded ? 'h-auto max-h-96' : 'h-32'} object-cover object-top`}
              />
            ))}
          </div>
          {!imagesExpanded && (
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center bg-gradient-to-t from-background to-transparent pb-1 h-8">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setImagesExpanded(true);
                }}
                className="rounded bg-background/80 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                Раскрыть
              </button>
            </div>
          )}
        </div>
      ) : null}

      {initialRecentPost && (
        <div className="rounded-md border-l-2 border-primary/30 bg-muted/20 p-3 text-xs">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium">
              {initialRecentPost.profiles?.username || "Аноним"}:
            </span>
            <span className="text-xs text-muted-foreground">
              {formatShortRelativeTime(initialRecentPost.created_at)}
            </span>
          </div>
          <div className="line-clamp-3 break-words text-xs">
            {initialRecentPost.content.substring(0, 150)}
            {initialRecentPost.content.length > 150 && '...'}
          </div>
        </div>
      )}

      <PostCardActions>
        <div className="relative group/likes">
          <ActionButton
            minimal
            icon={<Heart className={`h-4 w-4 ${userLiked ? "fill-current" : ""}`} />}
            label="Нравится"
            count={likesCount}
            active={userLiked}
            disabled={!currentUserId}
            onClick={handleLike}
          />

          {likesCount > 0 && (
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 -translate-x-1/2 pb-2 opacity-0 transition-opacity duration-200 group-hover/likes:opacity-100">
              <div className="whitespace-nowrap rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
                <div className="mb-2 text-muted-foreground">
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
                          emojiId={liker.is_anonymous ? undefined : liker.nickname_emoji_id}
                          isAnonymous={liker.is_anonymous}
                          className="text-xs"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground">Пока нет лайков</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <ActionButton
          minimal
          icon={<MessageCircle className="h-4 w-4" />}
          label="Ответы"
          count={thread.post_count || 0}
          onClick={() => navigate(threadPath)}
        />
        <ActionButton
          minimal
          icon={<Share2 className="h-4 w-4" />}
          label="Поделиться"
          disabled={!currentUserId}
          onClick={() => setShareOpen(true)}
        />
      </PostCardActions>
    </PostCardShell>

    {galleryItems && (
      <Lightbox
        items={galleryItems}
        initialIndex={galleryIndex}
        onClose={() => setGalleryItems(null)}
      />
    )}

    <ShareSheet
      open={shareOpen}
      onOpenChange={setShareOpen}
      target={{ type: "thread", id: thread.id }}
      url={`${window.location.origin}${threadPath}`}
      title={thread.title || thread.content || "Запись"}
    />
    </>
  );
};

export { ThreadCard };
