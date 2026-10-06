import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Heart, MessageCircle, Repeat2, Share2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/integrations/api/compat";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { docHasMediaNodes, getDocCover } from "@/components/editor/media/mediaSchema";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { FavoriteButton } from "@/components/FavoriteButton";
import {
  PostCardShell,
  PostCardHeader,
  PostCardActions,
  PostSourceChip,
} from "@/components/post/PostCardChrome";

import { pauseAllInlineMedia } from "@/utils/mediaPlayback";
import { needsPostTeaser } from "@/utils/postTeaser";
import { PostTeaser } from "@/components/wall/PostTeaser";
import { PostCover } from "@/components/wall/PostCover";
import { usePostViewTracking } from "@/hooks/usePostViewTracking";
import {
  type WallPost,
  normalizeAttachments,
  getWallPostPath,
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
  const { t } = useTranslation();
  const attachments = useMemo(() => normalizeAttachments(post), [post]);
  const hasMediaNodes = useMemo(() => docHasMediaNodes(post.content_json), [post.content_json]);
  const inlineMedia = isFeatureEnabled("wallInlineMedia") && hasMediaNodes;
  const hasContent = Boolean(post.content?.trim()) || hasMediaNodes;
  // Reports the post as viewed once the card becomes visible in the viewport.
  const viewTrackingRef = usePostViewTracking(post.id);
  const postPath = getWallPostPath({ id: post.user_id, public_id: post.user_public_id }, post);
  const coverId = useMemo(() => getDocCover(post.content_json), [post.content_json]);
  const hiddenMediaIds = useMemo(
    () => (coverId && !coverId.placements.includes("inline") ? new Set([coverId.id]) : undefined),
    [coverId],
  );
  // Long, media-heavy posts are teased on the feed; the full post opens on its
  // own page.
  const teaserMode = needsPostTeaser(post.content_json, post.content);

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
    <PostCardShell
      ref={viewTrackingRef}
      onOpen={handleOpenPost}
      cornerAction={currentUserId ? <FavoriteButton itemType="wall_post" itemId={post.id} /> : undefined}
    >
      <PostCardHeader
        userPublicId={post.author.public_id}
        userId={post.author_id}
        username={post.author.username}
        displayName={post.author.display_name}
        emojiId={post.author.nickname_emoji_id}
        isAnonymous={post.author.is_anonymous}
        avatarUrl={post.author.avatar_url}
        createdAt={post.created_at}
        chips={<PostSourceChip label="Стена" />}
      />

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
                postAuthorPublicId={post.author.public_id}
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
      </PostCardActions>
    </PostCardShell>
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
