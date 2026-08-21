import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { ExternalLink, Heart, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/integrations/api/compat";
import { Card, CardContent } from "@/components/ui/card";
import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { renderTags } from "@/components/ThreadCard";
import { parseAttachments } from "@/components/ThreadAttachments";
import { safeDate } from "@/utils/safeDate";
import { isInteractiveTarget } from "@/utils/wallNormalizers";
import type { AttachmentMeta } from "@/types/forum";
import type { LightboxItem } from "@/components/Lightbox";

/** Thread shape the unified feed hands to the card (derived from a feed item
 * or the subscriptions query in Index.tsx). */
export interface FeedThread {
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
 * threads and wall posts read as one design. Reuses the same primitives:
 * UserBadge header, processed content, progressive WallAttachments (LQIP →
 * compressed preview → full original in the lightbox) and the ActionButton row.
 * New threads carry attachment meta (preview_key/lqip); legacy threads fall
 * back to plain image URLs, which render without the progressive fade.
 */
const legacyImageUrls = (thread: FeedThread): string[] =>
  Array.isArray(thread.image_urls) && thread.image_urls.length > 0
    ? thread.image_urls
    : thread.image_url
      ? [thread.image_url]
      : [];

const buildAttachments = (thread: FeedThread): AttachmentMeta[] => {
  // Rich attachments (may come as a JSON array, a JSON string, or null) carry
  // the preview_key/lqip meta needed for progressive loading.
  const parsed = parseAttachments(thread.attachments);
  if (parsed.length > 0) {
    // Some legacy threads have both: merge any image_urls not already covered
    // by the rich list so no photo silently disappears.
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

export const FeedThreadCard = ({
  thread,
  currentUserId,
  currentUsername,
  currentUserColor,
  initialLikesCount = 0,
  initialUserLiked = false,
  onImageClick,
}: FeedThreadCardProps) => {
  const dateLocale = useDateLocale();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const attachments = useMemo(() => buildAttachments(thread), [thread]);

  const boardPrefix = thread.boards?.is_gomosub ? "/g" : "";
  const boardSlug = thread.boards?.slug || "b";
  const threadPath = `${boardPrefix}/${boardSlug}/thread/${thread.id}`;

  const [likesCount, setLikesCount] = useState(initialLikesCount);
  const [isLiked, setIsLiked] = useState(initialUserLiked);
  const [isLiking, setIsLiking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setLikesCount(initialLikesCount);
    setIsLiked(initialUserLiked);
  }, [thread.id, initialLikesCount, initialUserLiked]);

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
        if (!isInteractiveTarget(e.target, e.currentTarget)) {
          handleOpenThread();
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpenThread();
        }
      }}
    >
      <CardContent className="space-y-4 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <UserBadge
                  userId={thread.user_id}
                  username={thread.profiles?.username || "Аноним"}
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
                <Link
                  to={`${boardPrefix}/${boardSlug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                >
                  в {boardPrefix || ""}/{boardSlug}/
                </Link>
              </div>
            </div>
          </div>
        </div>

        <h3 className="break-words text-base font-semibold leading-6 sm:text-[17px] sm:leading-7">
          {thread.title}
        </h3>

        {thread.tags && Object.keys(thread.tags).length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {renderTags(thread.tags, "inline")}
          </div>
        )}

        {thread.content?.trim() && (
          <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
            <ProcessedContent
              content={thread.content || ""}
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

        {attachments.length > 0 && (
          <WallAttachments
            attachments={attachments}
            galleryKey={`feed-thread-${thread.id}`}
            onImageClick={onImageClick}
          />
        )}

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
            icon={<ExternalLink className="h-4 w-4" />}
            label="Открыть запись"
            showLabel={false}
            onClick={handleOpenThread}
          />
          <ActionButton
            icon={<Share2 className="h-4 w-4" />}
            label={t("share.title")}
            showLabel={false}
            disabled={!currentUserId}
            onClick={() => setShareOpen(true)}
          />
        </div>
      </CardContent>
    </Card>
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
