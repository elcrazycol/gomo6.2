import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Heart, MessageCircle, Share2 } from "lucide-react";
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
import {
  PostCardShell,
  PostCardHeader,
  PostCardHeading,
  PostCardActions,
  PostSourceChip,
} from "@/components/post/PostCardChrome";
import { buildThreadAttachments } from "@/utils/threadAttachments";
import type { LightboxItem } from "@/components/Lightbox";

/** Thread shape as the g-sub board hands it to the card. */
export interface GomoThread {
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
  post_count: number;
  tags?: Record<string, unknown> | null;
  profiles: {
    username: string;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  latest_post?: {
    content: string;
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

interface GomoThreadCardProps {
  thread: GomoThread;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  /** Base path to the sub, e.g. `/g/tech` or `/g/tech/c/dev` (channel suffix optional). */
  boardPath: string;
  /** Human label for the source chip (sub or channel name); falls back to the path. */
  sourceLabel?: string;
  onImageClick: (items: LightboxItem[], index: number) => void;
}

// Private-tag content ([seeusers=]/[nousers=]/[adm]) is hidden from the feed
// preview — the card shows a hint instead of the raw BBCode.
const hasVisibilityTags = (content: string): boolean =>
  content.includes("[seeusers=") || content.includes("[nousers=") || content.includes("[adm]");

/**
 * Thread card for the g-sub board, in the same design language as the feed
 * wall card: compact header with avatar + source chip, rich content from the
 * composer (content_json), a progressive attachment grid and the icon-only
 * ActionButton row.
 */
export const GomoThreadCard = ({
  thread,
  currentUserId,
  currentUsername,
  currentUserColor,
  boardPath,
  sourceLabel,
  onImageClick,
}: GomoThreadCardProps) => {
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

  const threadPath = `${boardPath}/thread/${thread.id}`;
  const gomosubTags = Array.isArray(thread.tags?.gomosub_tags)
    ? (thread.tags?.gomosub_tags as string[])
    : [];

  const [likesCount, setLikesCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const handleOpenThread = useCallback(() => {
    navigate(threadPath);
  }, [navigate, threadPath]);

  // X-style: tapping a thread video opens the thread page and autoplays the
  // clip there instead of playing it inline on the feed.
  const handleVideoOpen = useCallback(() => {
    navigate(threadPath, { state: { autoplayVideo: true } });
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

  const fallbackSource = boardPath.replace(/^\/+/, "");

  return (
    <>
      <PostCardShell onOpen={handleOpenThread}>
        <PostCardHeading>
          <PostCardHeader
            userId={thread.user_id}
            username={thread.profiles?.username || t("common.anonymous")}
            displayName={thread.profiles?.display_name}
            emojiId={thread.profiles?.nickname_emoji_id}
            isAnonymous={thread.profiles?.is_anonymous}
            avatarUrl={thread.profiles?.avatar_url}
            createdAt={thread.created_at}
            chips={
              <PostSourceChip
                to={boardPath}
                label={sourceLabel ? `в ${sourceLabel}` : `в ${fallbackSource}/`}
              />
            }
          />

          <Link to={threadPath} className="block group/title" onClick={(e) => e.stopPropagation()}>
            <h3 className="break-words text-base font-semibold leading-6 transition-colors group-hover/title:text-primary sm:text-[17px] sm:leading-7">
              {thread.title}
            </h3>
          </Link>

          {/* Sub tags */}
          {gomosubTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {gomosubTags.map((tag) => (
                <span
                  key={`${thread.id}-g-${tag}`}
                  className="inline-block rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </PostCardHeading>

        {/* Content */}
        <MediaAttachmentsProvider
          value={{
            attachments,
            inlineMedia,
            galleryKey: `gomo-thread-${thread.id}`,
            hiddenMediaIds,
            onImageClick,
            onVideoOpen: handleVideoOpen,
          }}
        >
          {coverId?.placements.includes("top") && <PostCover attachmentId={coverId.id} />}
          {hasContent && (
            <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
              {hasVisibilityTags(thread.content) ? (
                <span className="italic text-muted-foreground">
                  {t("board.openThreadToView")}
                </span>
              ) : (
                <div
                  className={
                    thread.content.length > 900
                      ? "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
                      : ""
                  }
                >
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
                </div>
              )}
              {thread.content.length > 900 && (
                <Link
                  to={threadPath}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
                >
                  Читать полностью
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}

          {/* Attachments — legacy bottom gallery; with inline media on the
              photos already live inside the document. */}
          {attachments.length > 0 && !inlineMedia && (
            <WallAttachments
              attachments={attachments}
              galleryKey={`gomo-thread-${thread.id}`}
              onImageClick={onImageClick}
              onVideoOpen={handleVideoOpen}
            />
          )}
        </MediaAttachmentsProvider>

        {/* Actions */}
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
            icon={<Share2 className="h-4 w-4" />}
            label={t("share.title")}
            disabled={!currentUserId}
            onClick={() => setShareOpen(true)}
          />
        </PostCardActions>
      </PostCardShell>
      {/* Outside the Card so clicks inside the sheet never bubble into the
          card's navigate handler. */}
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
