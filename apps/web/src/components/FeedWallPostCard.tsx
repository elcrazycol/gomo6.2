import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { Heart, MessageCircle, Repeat2, Share2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/integrations/api/compat";
import { Card, CardContent } from "@/components/ui/card";
import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { PostViewCount } from "@/components/PostViewCount";
import { safeDate } from "@/utils/safeDate";
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
  const dateLocale = useDateLocale();
  const navigate = useNavigate();
  const attachments = useMemo(() => normalizeAttachments(post), [post]);
  // Reports the post as viewed once the card becomes visible in the viewport.
  const viewTrackingRef = usePostViewTracking(post.id);
  const postPath = getWallPostPath(post.user_id, post.id);

  const [likesCount, setLikesCount] = useState(post.likes_count ?? 0);
  const [isLiked, setIsLiked] = useState(Boolean(post.liked_by_viewer));
  const [isLiking, setIsLiking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const handleOpenPost = useCallback(() => {
    navigate(postPath);
  }, [navigate, postPath]);

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
    <Card
      ref={viewTrackingRef}
      className="overflow-clip border-border/70 shadow-none bg-background"
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
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <UserBadge
                  userId={post.author_id}
                  username={post.author.username}
                  displayName={post.author.display_name}
                  emojiId={post.author.nickname_emoji_id}
                  isAnonymous={post.author.is_anonymous}
                  disableLink={false}
                  stopPropagationOnClick
                />
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(safeDate(post.created_at), {
                    locale: dateLocale,
                    addSuffix: true,
                  })}
                </span>
                <span className="inline-flex items-center gap-1 border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                  Запись со стены
                </span>
              </div>
            </div>
          </div>
        </div>

        {post.content?.trim() && (
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

        {attachments.length > 0 && (
          <WallAttachments
            attachments={attachments}
            galleryKey={`feed-${post.id}`}
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
            label="Комментарии"
            count={post.comments_count ?? 0}
            onClick={handleOpenPost}
          />
          <ActionButton
            icon={<Repeat2 className="h-4 w-4" />}
            label="Репосты"
            count={post.reposts_count ?? 0}
            onClick={handleOpenPost}
          />
          <ActionButton
            icon={<Share2 className="h-4 w-4" />}
            label="Поделиться"
            showLabel={false}
            disabled={!currentUserId}
            onClick={() => setShareOpen(true)}
          />
          <PostViewCount count={post.views_count ?? 0} />
        </div>
      </CardContent>
      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        target={{ type: "wall", id: post.id }}
        url={`${window.location.origin}${postPath}`}
        title={post.content || post.title || "Запись со стены"}
      />
    </Card>
  );
};
