import { useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronDown, Edit3, Ellipsis, Heart, Loader2, Reply, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ProcessedContent } from "@/components/ProcessedContent";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { WallCommentComposer } from "./WallCommentComposer";
import { useCommentTree, MAX_COMMENT_DEPTH, getThreadColor } from "./WallCommentContext";
import { api } from "@/integrations/api/compat";
import type { WallComment } from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";
import { storageUrl } from "@/utils/storage";

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
  const branchOffset = depth === 0 ? "ml-[18px] pl-[18px] sm:ml-5 sm:pl-5" : "ml-4 pl-4";
  const connectorOffset = "-left-4 w-4 sm:-left-5 sm:w-5";
  const lineOffset = depth === 0 ? "left-[18px] top-7 sm:left-5 sm:top-8" : "left-4 top-7";
  const avatarUrl = storageUrl("post-images", comment.author.avatar_url);
  const authorLabel = comment.author.display_name || comment.author.username;

  // Comment like count + my like state come embedded in the comments GET
  // response (likes_count / liked_by_viewer) — no per-comment requests.
  const [likeCount, setLikeCount] = useState(comment.likes_count ?? 0);
  const [isLiked, setIsLiked] = useState(Boolean(comment.liked_by_viewer));
  const [likeLoading, setLikeLoading] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

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
  const childrenId = `wall-comment-children-${comment.id}`;

  return (
    <div className="relative">
      {depth > 0 && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute ${connectorOffset} top-2.5 h-4 rounded-bl-xl border-b-2 border-l-2`}
          style={{ borderColor: threadColor }}
        />
      )}

      {hasChildren && !isCollapsed && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-0 ${lineOffset} border-l-2`}
          style={{ borderColor: threadColor }}
        />
      )}

      <div className="group rounded-2xl py-2.5 transition-colors hover:bg-muted/20">
          <div className="flex items-start gap-3">
            <Link
              to={`/profile/${comment.user_id}`}
              className="mt-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar className={`${depth === 0 ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8"} border border-border/70 bg-muted shadow-sm`}>
                <AvatarImage
                  src={avatarUrl || undefined}
                  alt={authorLabel}
                />
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {authorLabel.charAt(0).toUpperCase()}
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
                  {authorLabel}
                </Link>
                {comment.author.nickname_emoji_id && <NicknameEmoji emojiId={comment.author.nickname_emoji_id} />}
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
                <div className="mt-1.5 max-w-[68ch] break-words text-sm leading-6 text-foreground/95">
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
                <div className="mt-2 flex flex-wrap items-center gap-1 opacity-90 transition-opacity sm:opacity-70 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
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

                  {hasChildren && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleCollapse(comment.id)}
                      aria-expanded={!isCollapsed}
                      aria-controls={childrenId}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${isCollapsed ? "" : "rotate-180"}`}
                      />
                      <span>
                        {isCollapsed ? `Показать ${children.length} ${children.length === 1 ? "ответ" : children.length < 5 ? "ответа" : "ответов"}` : "Свернуть"}
                      </span>
                    </Button>
                  )}

                  {(canEdit || canDelete) && (                      <>
                        <div className="hidden items-center gap-1 sm:flex">
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
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
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteComment(comment.id)}
                            disabled={isSubmitting[`delete:${comment.id}`]}
                            title="Удалить"
                          >
                            {isSubmitting[`delete:${comment.id}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                      <>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-muted-foreground sm:hidden" aria-label="Действия с комментарием" onClick={() => setMobileActionsOpen(true)}>
                          <Ellipsis className="h-4 w-4" />
                        </Button>
                        <Sheet open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
                          <SheetContent side="bottom" className="rounded-t-3xl px-4 pb-8 pt-6 sm:hidden">
                            <SheetHeader className="mb-4 text-left">
                              <SheetTitle>Действия с комментарием</SheetTitle>
                            </SheetHeader>
                            <div className="grid gap-2">
                              {canEdit && (
                                <Button type="button" variant="outline" className="h-11 justify-start rounded-xl" onClick={() => {
                                    setMobileActionsOpen(false);
                                    if (isEditing) cancelEdit();
                                    else startEdit(comment);
                                  }}>
                                  <Edit3 className="mr-2 h-4 w-4" />Редактировать
                                </Button>
                              )}
                              {canDelete && (
                                <Button type="button" variant="outline" className="h-11 justify-start rounded-xl text-destructive hover:text-destructive" onClick={() => {
                                  setMobileActionsOpen(false);
                                  void deleteComment(comment.id);
                                }}>
                                  <Trash2 className="mr-2 h-4 w-4" />Удалить
                                </Button>
                              )}
                            </div>
                          </SheetContent>
                        </Sheet>
                      </>
                    </>
                  )}
                </div>
              )}

              {isReplying && currentUserId && (
                <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/[0.035] p-3 shadow-sm">
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
          id={childrenId}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${isCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
        >
          <div className="min-h-0 overflow-hidden">
            {hasChildren && (
              <div className={`relative mt-1 space-y-0 ${branchOffset}`}>
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
        </div>
    </div>
  );
};
