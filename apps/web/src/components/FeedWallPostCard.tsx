import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Heart, MessageCircle, Repeat2, Share2, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/integrations/api/compat";
import { Card, CardContent } from "@/components/ui/card";
import { UserBadge } from "@/components/UserBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { docHasMediaNodes, getDocCover } from "@/components/editor/media/mediaSchema";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { PostViewCount } from "@/components/PostViewCount";

import { safeDate } from "@/utils/safeDate";
import { formatShortRelativeTime } from "@/utils/relativeTimeShort";
import { getIntlLanguage } from "@/i18n/dateLocale";
import { pauseAllInlineMedia } from "@/utils/mediaPlayback";
import { needsPostTeaser } from "@/utils/postTeaser";
import { PostTeaser } from "@/components/wall/PostTeaser";
import { PostCover } from "@/components/wall/PostCover";
import { usePostViewTracking } from "@/hooks/usePostViewTracking";
import {
  type WallPost,
  normalizeAttachments,
  getWallPostPath,
  isInteractiveTarget,
} from "@/utils/wallNormalizers";
import type { LightboxItem } from "@/components/Lightbox";

interface FeedWallPostCardProps {
  post: WallPost;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  onImageClick: (items: LightboxItem[], index: number) => void;
}

/**
 * Lightweight wall-post card for the unified feed. Reuses the same rendering
 * primitives as the full WallPostCard (author, processed content, progressive
 * attachments) but stays read-only: no editor, no pin, no repost flow. The
 * like button is live; everything else navigates to the post's own page.
 */
export const FeedWallPostCard = ({
  post,
  currentUserId,
  currentUsername,
  currentUserColor,
  onImageClick,
}: FeedWallPostCardProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const attachments = useMemo(() => normalizeAttachments(post), [post]);
  const hasMediaNodes = useMemo(() => docHasMediaNodes(post.content_json), [post.content_json]);
  const inlineMedia = isFeatureEnabled("wallInlineMedia") && hasMediaNodes;
  const hasContent = Boolean(post.content?.trim()) || hasMediaNodes;
  // Reports the post as viewed once the card becomes visible in the viewport.
  const viewTrackingRef = usePostViewTracking(post.id);
  const postPath = getWallPostPath(post.user_id, post.id);
  const coverId = useMemo(() => getDocCover(post.content_json), [post.content_json]);
  const hiddenMediaIds = useMemo(
    () => (coverId && !coverId.placements.includes("inline") ? new Set([coverId.id]) : undefined),
    [coverId],
  );
  // Long, media-heavy posts are teased on the feed; the full post opens on its
  // own page.
  const teaserMode = needsPostTeaser(post.content_json, post.content);

  // Compact meta shown in the card header: a single-unit relative time ("5м",
  // "сейчас", "2д") at the right edge, with the exact date on hover.
  const createdAt = safeDate(post.created_at);
  const timeLabel = formatShortRelativeTime(createdAt, i18n.language);
  const timeTitle = createdAt.toLocaleString(getIntlLanguage(i18n.language));
  const authorName = post.author.display_name?.trim() || post.author.username;

  const [likesCount, setLikesCount] = useState(post.likes_count ?? 0);
  const [isLiked, setIsLiked] = useState(Boolean(post.liked_by_viewer));
  const [isLiking, setIsLiking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const handleOpenPost = useCallback(() => {
    // The post opens as an overlay over the feed; stop any inline clip that is
    // playing underneath so it does not keep running behind the post page.
    pauseAllInlineMedia();
    // Carry the already rendered card to the post page (removes the skeleton
    // flash) and keep the feed mounted underneath via backgroundLocation so the
    // post opens as a draggable overlay over it.
    navigate(postPath, { state: { wallPost: post, backgroundLocation: location } });
  }, [navigate, post, postPath, location]);

  const handleLikeToggle = async () => {
    if (!currentUserId || isLiking) return;
    setIsLiking(true);
    try {
      if (isLiked) {
        const { error } = await api
          .from("profile_wall_post_likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUserId);
        if (error) throw error;
        setIsLiked(false);
        setLikesCount((prev) => Math.max(0, prev - 1));
      } else {
        const { error } = await api
          .from("profile_wall_post_likes")
          .insert({ post_id: post.id, user_id: currentUserId });
        if (error) throw error;
        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
      }
    } catch (err) {
      console.error("Error toggling wall like:", err);
      toast.error("Не удалось изменить лайк");
    } finally {
      setIsLiking(false);
    }
  };

  return (
    <>
    <Card
      ref={viewTrackingRef}
      className="overflow-clip rounded-lg border-border/70 shadow-none bg-background"
      onClick={(e) => {
        if (!isInteractiveTarget(e.target, e.currentTarget)) {
          handleOpenPost();
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpenPost();
        }
      }}
    >
      <CardContent className="space-y-4 p-3 sm:p-4">
        <div className="flex items-center gap-3">
          {post.author.is_anonymous ? (
            <UserAvatar
              userId={null}
              alt={authorName}
              className="h-8 w-8 shrink-0"
            />
          ) : (
            <Link
              to={`/profile/${post.author_id}`}
              onClick={(event) => event.stopPropagation()}
              className="flex shrink-0 items-center"
            >
              <UserAvatar
                src={post.author.avatar_url}
                userId={post.author_id}
                alt={authorName}
                className="h-8 w-8"
              />
            </Link>
          )}

          {/* `flex` (not a plain block) so the badge is centred as a flex item —
              as an inline-flex inside a block it baseline-aligns against the
              line box and drifts below the avatar's centre. */}
          <div className="flex min-w-0 flex-1 items-center">
            <UserBadge
              userId={post.author_id}
              username={post.author.username}
              displayName={post.author.display_name}
              emojiId={post.author.nickname_emoji_id}
              isAnonymous={post.author.is_anonymous}
              disableLink={false}
              stopPropagationOnClick
            />
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-[13px] font-medium leading-none text-foreground/85">
              <StickyNote className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              стена
            </span>
            <time
              className="text-sm font-medium tabular-nums text-muted-foreground"
              dateTime={createdAt.toISOString()}
              title={timeTitle}
            >
              {timeLabel}
            </time>
          </div>
        </div>

        <MediaAttachmentsProvider
          value={{
            attachments,
            inlineMedia,
            galleryKey: `feed-${post.id}`,
            hiddenMediaIds,
            onImageClick,
          }}
        >
        {coverId?.placements.includes("top") && <PostCover attachmentId={coverId.id} />}
        {teaserMode ? (
          <PostTeaser contentJson={post.content_json} onOpenPost={handleOpenPost} />
        ) : (
          <>
            {hasContent && (
              <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
                <ProcessedContent
                  content={(post.content as string) || ""}
                  contentJson={post.content_json}
                  currentUserId={currentUserId}
                  isAdmin={false}
                  currentUsername={currentUsername}
                  currentUserColor={currentUserColor}
                  postAuthorId={post.author_id}
                  authorUsername={post.author.username}
                  showHiddenIndicators={false}
                />
              </div>
            )}

            {attachments.length > 0 && !inlineMedia && (
              <WallAttachments
                attachments={attachments}
                galleryKey={`feed-${post.id}`}
                onImageClick={onImageClick}
              />
            )}
          </>
        )}
        </MediaAttachmentsProvider>

        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
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
            label="Комментарии"
            count={post.comments_count ?? 0}
            onClick={handleOpenPost}
          />
          <ActionButton
            minimal
            icon={<Repeat2 className="h-4 w-4" />}
            label="Репосты"
            count={post.reposts_count ?? 0}
            onClick={handleOpenPost}
          />
          <ActionButton
            minimal
            icon={<Share2 className="h-4 w-4" />}
            label={t("share.title")}
            disabled={!currentUserId}
            onClick={() => setShareOpen(true)}
          />
          <PostViewCount count={post.views_count ?? 0} minimal />
        </div>
      </CardContent>
    </Card>
    {/* Rendered outside the Card so clicks inside the sheet can never bubble
        into the card's navigate-on-click handler. */}
    <ShareSheet
      open={shareOpen}
      onOpenChange={setShareOpen}
      target={{ type: "wall", id: post.id }}
      url={`${window.location.origin}${postPath}`}
      title={post.content || post.title || "Запись со стены"}
    />
    </>
  );
};
