import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { ArrowUpRight, Heart, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/integrations/api/compat";
import { Card, CardContent } from "@/components/ui/card";
import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { parseAttachments } from "@/components/ThreadAttachments";
import { safeDate } from "@/utils/safeDate";
import type { AttachmentMeta } from "@/types/forum";
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
  channelSlug?: string | null;
  channelName?: string | null;
  onImageClick: (items: LightboxItem[], index: number) => void;
}

// Private-tag content ([seeusers=]/[nousers=]/[adm]) is hidden from the feed
// preview — the card shows a hint instead of the raw BBCode.
const hasVisibilityTags = (content: string): boolean =>
  content.includes("[seeusers=") || content.includes("[nousers=") || content.includes("[adm]");

const legacyImageUrls = (thread: GomoThread): string[] =>
  Array.isArray(thread.image_urls) && thread.image_urls.length > 0
    ? thread.image_urls
    : thread.image_url
      ? [thread.image_url]
      : [];

const buildAttachments = (thread: GomoThread): AttachmentMeta[] => {
  const parsed = parseAttachments(thread.attachments);
  if (parsed.length > 0) {
    const known = new Set(
      parsed.filter((att) => att.type === "image").map((att) => att.url),
    );
    const extra = legacyImageUrls(thread)
      .filter((url) => !known.has(url))
      .map((url) => ({
        url,
        type: "image" as const,
        mime: "image/*",
        name: "image",
        size: 0,
      }));
    return [...parsed, ...extra];
  }
  return legacyImageUrls(thread).map((url) => ({
    url,
    type: "image" as const,
    mime: "image/*",
    name: "image",
    size: 0,
  }));
};

/**
 * Thread card for the g-sub board, in the same design language as the wall
 * (WallPostCard): clean UserBadge header with a channel chip, rich content
 * from the composer (content_json), a progressive attachment grid and the
 * ActionButton row. Replaces the old compact board card.
 */
export const GomoThreadCard = ({
  thread,
  currentUserId,
  currentUsername,
  currentUserColor,
  boardPath,
  channelSlug,
  channelName,
  onImageClick,
}: GomoThreadCardProps) => {
  const dateLocale = useDateLocale();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const attachments = useMemo(() => buildAttachments(thread), [thread]);

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

  return (
    <>
      <Card
        className="overflow-clip border-border/70 shadow-none bg-background"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("a, button, [role='button']")) return;
          handleOpenThread();
        }}
      >
        <CardContent className="space-y-4 p-3 sm:p-4">
          {/* Header: author + time + channel/board chips */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <UserBadge
                    userId={thread.user_id}
                    username={thread.profiles?.username || t("common.anonymous")}
                    displayName={thread.profiles?.display_name}
                    emojiId={thread.profiles?.nickname_emoji_id}
                    isAnonymous={thread.profiles?.is_anonymous}
                    disableLink={false}
                    stopPropagationOnClick
                  />
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(safeDate(thread.created_at), {
                      locale: dateLocale,
                      addSuffix: true,
                    })}
                  </span>
                  {channelSlug && (
                    <Link
                      to={`${boardPath}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      # {channelName || channelSlug}
                    </Link>
                  )}
                  <Link
                    to={boardPath}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                  >
                    в g/{boardPath.split("/").filter(Boolean)[1] || ""}/
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Title */}
          <Link to={threadPath} className="block group/title" onClick={(e) => e.stopPropagation()}>
            <h3 className="break-words text-[17px] font-bold leading-snug group-hover/title:text-primary transition-colors sm:text-[1.35rem]">
              {thread.title}
            </h3>
          </Link>

          {/* Sub tags */}
          {gomosubTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {gomosubTags.map((tag) => (
                <span
                  key={`${thread.id}-g-${tag}`}
                  className="inline-block px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full border border-primary/20"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Content */}
          {thread.content?.trim() && (
            <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
              {hasVisibilityTags(thread.content) ? (
                <span className="text-muted-foreground italic">
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
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          )}

          {/* Attachments — progressive grid like the wall */}
          {attachments.length > 0 && (
            <WallAttachments
              attachments={attachments}
              galleryKey={`gomo-thread-${thread.id}`}
              onImageClick={onImageClick}
            />
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <ActionButton
              icon={<Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />}
              label="Нравится"
              count={likesCount}
              active={isLiked}
              disabled={!currentUserId}
              loading={isLiking}
              onClick={handleLikeToggle}
            />
            <ActionButton
              icon={<MessageCircle className="h-4 w-4" />}
              label="Ответы"
              count={thread.post_count ?? 0}
              onClick={handleOpenThread}
            />
            <ActionButton
              icon={<ArrowUpRight className="h-4 w-4" />}
              label="Открыть запись"
              showLabel={false}
              onClick={handleOpenThread}
            />
            <ActionButton
              icon={<Share2 className="h-4 w-4" />}
              label={t("share.title")}
              showLabel={false}
              title={t("share.title")}
              disabled={!currentUserId}
              onClick={() => setShareOpen(true)}
            />
          </div>
        </CardContent>
      </Card>
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
