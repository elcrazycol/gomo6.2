import { type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Repeat2 } from "lucide-react";

import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { PostCardHeader } from "@/components/post/PostCardChrome";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { docHasMediaNodes } from "@/components/editor/media/mediaSchema";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { normalizeAttachments, isInteractiveTarget, getWallPostPath } from "@/utils/wallNormalizers";
import type { WallPost } from "@/utils/wallNormalizers";
import type { LightboxItem } from "@/components/Lightbox";

interface EmbeddedWallPostProps {
  post: WallPost;
  currentUserId: string | null;
  currentUsername: string;
  onImageClick: (items: LightboxItem[], index: number) => void;
  /** Hide the "Оригинальная запись" header (used when the post is not a repost embed). */
  hideHeader?: boolean;
}

export const EmbeddedWallPost = ({
  post,
  currentUserId,
  currentUsername,
  onImageClick,
  hideHeader = false,
}: EmbeddedWallPostProps) => {
  const navigate = useNavigate();
  const attachments = normalizeAttachments(post);
  const hasMediaNodes = docHasMediaNodes(post.content_json);
  const inlineMedia = isFeatureEnabled("wallInlineMedia") && hasMediaNodes;
  const hasContent = Boolean(post.content?.trim()) || hasMediaNodes;
  const handleOpenPost = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target, event.currentTarget)) return;
    navigate(getWallPostPath(post.user_id, post.id), { state: { wallPost: post } });
  };

  return (
    <div
      className="rounded-lg border border-border/70 bg-muted/[0.12] p-3 transition-colors hover:bg-muted/[0.18] sm:p-4"
      onClick={handleOpenPost}
      role="button"
      tabIndex={0}
    >
      {!hideHeader && (
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <Repeat2 className="h-3.5 w-3.5" />
          <span>Оригинальная запись</span>
        </div>
      )}

      <div className={hideHeader ? "" : "mb-3"}>
        <PostCardHeader
          userId={post.author_id}
          username={post.author.username}
          displayName={post.author.display_name}
          emojiId={post.author.nickname_emoji_id}
          isAnonymous={post.author.is_anonymous}
          avatarUrl={post.author.avatar_url}
          createdAt={post.created_at}
        />
      </div>

      <MediaAttachmentsProvider
        value={{
          attachments,
          inlineMedia,
          galleryKey: `embedded-${post.id}`,
          onImageClick,
        }}
      >
      {hasContent && (
        <div className="break-words text-sm leading-6 sm:text-[15px]">
          <ProcessedContent
            content={(post.content as string | null) ?? ""}
            contentJson={post.content_json}
            currentUserId={currentUserId}
            isAdmin={false}
            currentUsername={currentUsername}
          />
        </div>
      )}

      {attachments.length > 0 && !inlineMedia && (
        <div className="mt-3">
          <WallAttachments
            attachments={attachments}
            galleryKey={`embedded-${post.id}`}
            onImageClick={onImageClick}
          />
        </div>
      )}
      </MediaAttachmentsProvider>
    </div>
  );
};
