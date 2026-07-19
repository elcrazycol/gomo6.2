import { useEffect, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronDown, Edit3, Heart, Loader2, Reply, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallCommentComposer } from "./WallCommentComposer";
import { useCommentTree, MAX_COMMENT_DEPTH, getThreadColor } from "./WallCommentContext";
import { api } from "@/integrations/api/compat";
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
  const threadColor = getThreadColor(depth);

  const [likeCount, setLikeCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  useEffect(() => {
    if (!currentUserId) return;
    const loadLikeState = async () => {
      try {
        const [countRes, stateRes] = await Promise.all([
          api.from("profile_wall_comment_likes").select("id", { count: "exact", head: true }).eq("comment_id", comment.id),
          api.from("profile_wall_comment_likes").select("id").eq("comment_id", comment.id).eq("user_id", currentUserId).maybeSingle(),
        ]);
        setLikeCount(countRes.count || 0);
        setIsLiked(Boolean(stateRes.data));
      } catch {
        // silent
      }
    };
    loadLikeState();
  }, [comment.id, currentUserId]);

  const handleLikeToggle = useCallback(async () => {
    if (!currentUserId || likeLoading) return;
    setLikeLoading(true);
    const prevLiked = isLiked;
    const prevCount = likeCount;
    try {
      if (isLiked) {
        setIsLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
        const { error } = await api.from("profile_wall_comment_likes").delete().eq("comment_id", comment.id).eq("user_id", currentUserId);
        if (error) throw error;
      } else {
        setIsLiked(true);
        setLikeCount((c) => c + 1);
        const { error } = await api.from("profile_wall_comment_likes").insert({ comment_id: comment.id, user_id: currentUserId });
        if (error) throw error;
      }
    } catch {
      setIsLiked(prevLiked);
      setLikeCount(prevCount);
    } finally {
      setLikeLoading(false);
    }
  }, [currentUserId, comment.id, isLiked, likeCount, likeLoading]);

  const replyAuthorName = depth > 0 ? (comment.author.display_name || comment.author.username) : null;

  return (
    <div className="relative">
      {depth > 0 && (
        <button
          type="button"
          aria-label={isCollapsed ? "Развернуть ветку" : "Свернуть ветку"}
          className="absolute bottom-0 left-0 top-0 z-10 w-4 cursor-pointer sm:w-5"
          style={{
            borderLeft: `3px solid ${threadColor}`,
            opacity: isCollapsed ? 1 : 0.7,
            transition: "opacity 150ms ease, border-color 150ms ease",
            borderRadius: "2px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
            e.currentTarget.style.borderLeftColor = "rgba(128,128,128,0.55)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = isCollapsed ? "1" : "0.7";
            e.currentTarget.style.borderLeftColor = threadColor;
          }}
          onClick={() => toggleCollapse(comment.id)}
        />
      )}

      <div
        className={depth > 0 ? "pl-3 sm:pl-5" : ""}
      >
        <div className="group rounded-md py-2.5 transition-colors hover:bg-muted/30">
          <div className="flex items-start gap-2.5">
            <Link
              to={`/profile/${comment.user_id}`}
              className="mt-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
                <AvatarImage
                  src={comment.author.avatar_url || undefined}
                  alt={comment.author.username}
                />
                <AvatarFallback className="text-[10px]">
                  {(comment.author.display_name || comment.author.username).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link
                  to={`/profile/${comment.user_id}`}
                  className="text-sm font-semibold text-foreground hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {comment.author.display_name || comment.author.username}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(safeDate(comment.created_at), { locale: ru, addSuffix: true })}
                </span>
                {comment.updated_at !== comment.created_at && (
                  <span className="text-[11px] text-muted-foreground">(ред.)</span>
                )}
              </div>

              {replyAuthorName && depth > 0 && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  ответ <span className="font-medium text-foreground/70">{replyAuthorName}</span>
                </div>
              )}

              {isEditing ? (
                <div className="mt-2">
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
                <div className="mt-1 break-words text-sm leading-relaxed">
                  <ProcessedContent
                    content={comment.content || ""}
                    contentJson={comment.content_json}
                    currentUserId={currentUserId}
                    isAdmin={false}
                    currentUsername={currentUsername}
                  />
                </div>
              )}

              {!isEditing && (
                <div className="mt-1.5 flex items-center gap-1">
                  {currentUserId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-7 gap-1 px-1.5 text-xs ${isLiked ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={handleLikeToggle}
                      disabled={likeLoading}
                    >
                      <Heart className={`h-3.5 w-3.5 ${isLiked ? "fill-current" : ""}`} />
                      {likeCount > 0 && <span>{likeCount}</span>}
                    </Button>
                  )}

                  {canReply && currentUserId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => (isReplying ? cancelReply() : startReply(comment.id))}
                    >
                      <Reply className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Ответить</span>
                    </Button>
                  )}

                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
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

                  {hasChildren && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleCollapse(comment.id)}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${isCollapsed ? "" : "rotate-180"}`}
                      />
                      <span className="hidden sm:inline">
                        {isCollapsed ? `${children.length} ${children.length === 1 ? "ответ" : "ответов"}` : "Свернуть"}
                      </span>
                    </Button>
                  )}
                </div>
              )}

              {isReplying && currentUserId && (
                <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="mb-2 text-[11px] text-muted-foreground">
                    Ответ <span className="font-medium text-foreground/70">{comment.author.display_name || comment.author.username}</span>
                  </div>
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
          </div>
        </div>

        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: isCollapsed ? "0px" : "2000px",
            opacity: isCollapsed ? 0 : 1,
          }}
        >
          {hasChildren && (
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

        {isCollapsed && hasChildren && (
          <button
            type="button"
            className="ml-2 mt-1 text-xs font-medium text-muted-foreground hover:underline"
            onClick={() => toggleCollapse(comment.id)}
          >
            Показать {children.length} {children.length === 1 ? "ответ" : "ответов"}
          </button>
        )}
      </div>
    </div>
  );
};
