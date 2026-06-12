import { type MouseEvent as ReactMouseEvent } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { Repeat2 } from "lucide-react";


import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { normalizeAttachments, isInteractiveTarget, getWallPostPath } from "@/utils/wallNormalizers";
import type { WallPost } from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";

interface EmbeddedWallPostProps {
  post: WallPost;
  currentUserId: string | null;
  currentUsername: string;
  onImageClick: (images: string[], index: number) => void;
}

export const EmbeddedWallPost = ({
  post,
  currentUserId,
  currentUsername,
  onImageClick,
}: EmbeddedWallPostProps) => {
  const navigate = useNavigate();
  const attachments = normalizeAttachments(post);
  const handleOpenPost = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target, event.currentTarget)) return;
    navigate(getWallPostPath(post.user_id, post.id));
  };

  return (
    <div
      className="rounded-[1.1rem] border border-border/70 bg-muted/[0.12] p-3 transition-colors hover:bg-muted/[0.18] sm:p-4"
      onClick={handleOpenPost}
      role="button"
      tabIndex={0}
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <Repeat2 className="h-3.5 w-3.5" />
        <span>Оригинальная запись</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <UserBadge
          userId={post.author_id}
          username={post.author.username}
          isAnonymous={post.author.is_anonymous}
          disableLink={false}
          stopPropagationOnClick
        />
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(safeDate(post.created_at), {
            locale: ru,
            addSuffix: true,
          })}
        </span>
      </div>

      {post.content?.trim() && (
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

      {attachments.length > 0 && (
        <div className="mt-3">
          <WallAttachments
            attachments={attachments}
            galleryKey={`embedded-${post.id}`}
            onImageClick={onImageClick}
          />
        </div>
      )}
    </div>
  );
};
