import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Heart, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/integrations/api/compat";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { docHasMediaNodes, ensureAttachmentIds, getDocCover } from "@/components/editor/media/mediaSchema";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { PostCover } from "@/components/wall/PostCover";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { FavoriteButton } from "@/components/FavoriteButton";
import {
  PostCardShell,
  PostCardHeader,
  PostCardHeading,
  PostCardActions,
  PostSourceChip,
} from "@/components/post/PostCardChrome";
import { renderTags } from "@/components/ThreadCard";
import { SectionIcon } from "@/components/topic/sectionIcons";
import { buildThreadAttachments } from "@/utils/threadAttachments";
import { pauseAllInlineMedia } from "@/utils/mediaPlayback";
import type { LightboxItem } from "@/components/Lightbox";
import { entityParam } from "@/utils/entityUrl";

/** Thread shape the unified feed hands to the card (derived from a feed item
 * or the subscriptions query in Index.tsx). */
export interface FeedThread {
  id: string;
  /** Public number of the author, for /profile/<n> links. */
  user_public_id?: number | null;
  title: string;
  content: string;
  content_json?: unknown;
  image_url: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  board_id: string;
  post_count: number;
  tags?: Record<string, string>;
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
}

interface FeedThreadCardProps {
  thread: FeedThread;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  initialLikesCount?: number;
  initialUserLiked?: boolean;
  onImageClick: (items: LightboxItem[], index: number) => void;
}

/**
 * Thread card for the unified feed, styled exactly like FeedWallPostCard so
 * threads and wall posts read as one design. Reuses the shared post chrome
 * (header with avatar + source chip + short time, progressive WallAttachments
 * and the icon-only action row). New threads carry attachment meta
 * (preview_key/lqip); legacy threads fall back to plain image URLs, which
 * render without the progressive fade.
 */
export const FeedThreadCard = ({
  thread,
  currentUserId,
  currentUsername,
  currentUserColor,
  initialLikesCount = 0,
  initialUserLiked = false,
  onImageClick,
}: FeedThreadCardProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const attachments = useMemo(() => ensureAttachmentIds(buildThreadAttachments(thread)), [thread]);
  // Inline media is the new presentation; legacy threads keep the bottom gallery.
  const hasMediaNodes = useMemo(() => docHasMediaNodes(thread.content_json), [thread.content_json]);
  const inlineMedia = isFeatureEnabled("wallInlineMedia") && hasMediaNodes;
  const hasContent = Boolean(thread.content?.trim()) || hasMediaNodes;
  const coverId = useMemo(() => getDocCover(thread.content_json), [thread.content_json]);
  const hiddenMediaIds = useMemo(
    () => (coverId && !coverId.placements.includes("inline") ? new Set([coverId.id]) : undefined),
    [coverId],
  );

  const isGlobalTopic = !thread.boards?.slug;
  const boardPrefix = thread.boards?.is_gomosub ? "/g" : "";
  const boardSlug = thread.boards?.slug || "";
  const threadPath = isGlobalTopic
    ? `/thread/${entityParam(thread)}`
    : `${boardPrefix}/${boardSlug}/thread/${entityParam(thread)}`;

  const [likesCount, setLikesCount] = useState(initialLikesCount);
  const [isLiked, setIsLiked] = useState(initialUserLiked);
  const [isLiking, setIsLiking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setLikesCount(initialLikesCount);
    setIsLiked(initialUserLiked);
  }, [thread.id, initialLikesCount, initialUserLiked]);

  const handleOpenThread = useCallback(() => {
    // Stop any inline clip playing on the feed before leaving for the thread.
    pauseAllInlineMedia();
    navigate(threadPath);
  }, [navigate, threadPath]);

  const handleLikeToggle = async () => {
    if (!currentUserId || isLiking) return;
    setIsLiking(true);
    try {
      if (isLiked) {
        const { error } = await api
          .from("thread_likes")
          .delete()
          .eq("thread_id", thread.id)
          .eq("user_id", currentUserId);
        if (error) throw error;
        setIsLiked(false);
        setLikesCount((prev) => Math.max(0, prev - 1));
      } else {
        const { error } = await api
          .from("thread_likes")
          .insert({ thread_id: thread.id, user_id: currentUserId });
        if (error) throw error;
        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
      }
    } catch (err) {
      console.error("Error toggling thread like:", err);
      toast.error("Не удалось изменить лайк");
    } finally {
      setIsLiking(false);
    }
  };

  // Source marker: a global topic shows its section (· subsection); a g-sub
  // thread shows a link to its board. Both render through the same chip as
  // the wall post's "стена".
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
    <PostCardShell
      onOpen={handleOpenThread}
      cornerAction={currentUserId ? <FavoriteButton itemType="thread" itemId={thread.id} /> : undefined}
    >
      <PostCardHeading>
        <PostCardHeader
          userId={thread.user_id}
          userPublicId={thread.user_public_id}
          username={thread.profiles?.username || "Аноним"}
          displayName={thread.profiles?.display_name}
          emojiId={thread.profiles?.nickname_emoji_id}
          isAnonymous={thread.profiles?.is_anonymous}
          avatarUrl={thread.profiles?.avatar_url}
          createdAt={thread.created_at}
          chips={sourceChip}
        />

        <h3 className="break-words text-base font-semibold leading-6 sm:text-[17px] sm:leading-7">
          {thread.title}
        </h3>

        {thread.tags && Object.keys(thread.tags).length > 0 &&
          renderTags(thread.tags, "inline")}
      </PostCardHeading>

      <MediaAttachmentsProvider
        value={{
          attachments,
          inlineMedia,
          galleryKey: `feed-thread-${thread.id}`,
          hiddenMediaIds,
          onImageClick,
        }}
      >
        {coverId?.placements.includes("top") && <PostCover attachmentId={coverId.id} />}
        {hasContent && (
          <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
            <ProcessedContent
              content={thread.content || ""}
              contentJson={thread.content_json}
              currentUserId={currentUserId}
              isAdmin={false}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
              postAuthorId={thread.user_id}
              postAuthorPublicId={thread.user_public_id}
              authorUsername={thread.profiles?.username}
              showHiddenIndicators={false}
            />
          </div>
        )}

        {attachments.length > 0 && !inlineMedia && (
          <WallAttachments
            attachments={attachments}
            galleryKey={`feed-thread-${thread.id}`}
            onImageClick={onImageClick}
          />
        )}
      </MediaAttachmentsProvider>

      <PostCardActions>
        <ActionButton
          minimal
          icon={<Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />}
          label="Нравится"
          count={likesCount}
          active={isLiked}
          disabled={!currentUserId}
          loading={isLiking}
          onClick={handleLikeToggle}
        />
        <ActionButton
          minimal
          icon={<MessageCircle className="h-4 w-4" />}
          label="Ответы"
          count={thread.post_count ?? 0}
          onClick={handleOpenThread}
        />
        <ActionButton
          minimal
          icon={<ExternalLink className="h-4 w-4" />}
          label="Открыть запись"
          onClick={handleOpenThread}
        />
        <ActionButton
          minimal
          icon={<Share2 className="h-4 w-4" />}
          label={t("share.title")}
          disabled={!currentUserId}
          onClick={() => setShareOpen(true)}
        />
      </PostCardActions>
    </PostCardShell>
    {/* Rendered outside the Card so clicks inside the sheet can never bubble
        into the card's navigate-on-click handler. */}
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
