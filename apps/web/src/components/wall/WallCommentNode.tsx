import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Edit3, Loader2, Reply, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallCommentComposer } from "./WallCommentComposer";
import { useCommentTree, MAX_COMMENT_DEPTH } from "./WallCommentContext";
import type { WallComment } from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";

interface WallCommentNodeProps {
  comment: WallComment;
  children: WallComment[];
  tree: Map<string | null, WallComment[]>;
  depth: number;
}

export const WallCommentNode = ({
  comment,
  children,
  tree,
  depth,
}: WallCommentNodeProps) => {
  const ctx = useCommentTree();
  const {
    currentUserId,
    postUserId,
    currentUsername,
    collapsedIds,
    activeReplyId,
    activeEditId,
    editorStates,
    isSubmitting,
    startReply,
    cancelReply,
    startEdit,
    cancelEdit,
    updateEditorState,
    submitReply,
    submitEdit,
    deleteComment,
    toggleCollapse,
  } = ctx;

  const isEditing = activeEditId === comment.id;
  const isReplying = activeReplyId === comment.id;
  const isCollapsed = collapsedIds.has(comment.id);
  const hasChildren = children.length > 0;
  const canReply = depth < MAX_COMMENT_DEPTH;
  const canEdit = currentUserId === comment.user_id;
  const canDelete = currentUserId === comment.user_id || currentUserId === postUserId;

  const replyState = editorStates[`reply:${comment.id}`] || { json: undefined, text: "" };
  const editState = editorStates[`edit:${comment.id}`] || {
    json: comment.content_json ?? undefined,
    text: comment.content || "",
  };
  const replySubmitting = isSubmitting[`reply:${comment.id}`] || false;
  const editSubmitting = isSubmitting[`edit:${comment.id}`] || false;

  const isMaxDepth = depth >= MAX_COMMENT_DEPTH;
  const shouldIndent = !isMaxDepth;

  return (
    <div
      className={shouldIndent && depth > 0 ? "border-l-2 border-border/40 pl-4" : ""}
    >
      <div className={depth === 0 ? "rounded-lg border border-border/60 bg-background p-3" : "py-2"}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <UserBadge
              userId={comment.user_id}
              username={comment.author.username}
              displayName={comment.author.display_name}
              isAnonymous={comment.author.is_anonymous}
              disableLink={false}
            />
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(safeDate(comment.created_at), { locale: ru, addSuffix: true })}
            </span>
            {hasChildren && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => toggleCollapse(comment.id)}
              >
                {isCollapsed ? `Показать ответы (${children.length})` : "Свернуть"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {canReply && currentUserId && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => (isReplying ? cancelReply() : startReply(comment.id))}
                title="Ответить"
              >
                <Reply className="h-3.5 w-3.5" />
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => (isEditing ? cancelEdit() : startEdit(comment))}
                title="Редактировать"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => deleteComment(comment.id)}
                disabled={isSubmitting[`delete:${comment.id}`]}
                title="Удалить"
              >
                {isSubmitting[`delete:${comment.id}`] ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="mt-2 space-y-2">
            <WallCommentComposer
              placeholder="Измените комментарий"
              onSubmit={() => submitEdit(comment.id)}
              onCancel={cancelEdit}
              isSubmitting={editSubmitting}
              json={editState.json}
              text={editState.text}
              onChange={(v) => updateEditorState(`edit:${comment.id}`, v)}
              resetKey={comment.id.length}
              compact
            />
          </div>
        ) : (
          <div className="break-words text-sm leading-6 sm:text-[15px]">
            <ProcessedContent
              content={comment.content || ""}
              contentJson={comment.content_json}
              currentUserId={currentUserId}
              isAdmin={false}
              currentUsername={currentUsername}
            />
          </div>
        )}

        {isReplying && currentUserId && (
          <div className="mt-3 border border-border/60 bg-muted/[0.16] p-3">
            <WallCommentComposer
              placeholder="Напишите ответ"
              onSubmit={() => submitReply(comment.id)}
              onCancel={cancelReply}
              isSubmitting={replySubmitting}
              json={replyState.json}
              text={replyState.text}
              onChange={(v) => updateEditorState(`reply:${comment.id}`, v)}
              compact
            />
          </div>
        )}
      </div>

      {!isCollapsed && hasChildren && (
        <div className="space-y-0">
          {children.map((child) => {
            const childChildren = tree.get(child.id) || [];
            return (
              <WallCommentNode
                key={child.id}
                comment={child}
                children={childChildren}
                tree={tree}
                depth={isMaxDepth ? depth : depth + 1}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
