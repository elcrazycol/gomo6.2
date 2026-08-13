import { useCallback, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronDown, Edit3, Ellipsis, Ghost, Heart, Loader2, Reply, Trash2 } from "lucide-react";
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
import { useCommentTree, MAX_COMMENT_DEPTH } from "./WallCommentContext";
import { api } from "@/integrations/api/compat";
import type { WallComment } from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";
import { storageUrl } from "@/utils/storage";

interface WallCommentNodeProps {
  comment: WallComment;
  children: WallComment[];
  tree: Map<string | null, WallComment[]>;
  depth: number;
  isLast: boolean;
}

export const WallCommentNode = ({
  comment,
  children,
  tree,
  depth,
  isLast,
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
    submitEdit,
    deleteComment,
    toggleCollapse,
    highlightedCommentId,
  } = ctx;

  const isHighlighted = highlightedCommentId === comment.id;
  const isEditing = activeEditId === comment.id;
  const isReplying = activeReplyId === comment.id;
  const isCollapsed = collapsedIds.has(comment.id);
  const hasChildren = children.length > 0;
  const canReply = depth < MAX_COMMENT_DEPTH;
  const canEdit = currentUserId === comment.user_id;
  const canDelete = currentUserId === comment.user_id || currentUserId === postUserId;

  const editState = editorStates[`edit:${comment.id}`] || {
    json: comment.content_json ?? undefined,
    text: comment.content || "",
  };
  const editSubmitting = isSubmitting[`edit:${comment.id}`] || false;

  const isMaxDepth = depth >= MAX_COMMENT_DEPTH;
  // Keep each reply avatar on a predictable rail: the first level moves by
  // 36px from the root avatar, deeper levels by one reply-avatar (32px).
  // Reply avatars sit on a predictable rail: the first level indents by the
  // full root avatar width (36/40px), deeper levels by one reply avatar (32px).
  const branchOffset = depth === 0 ? "ml-9 sm:ml-10" : "ml-8";
  const threadAxis = depth === 0 ? "left-[18px] sm:left-5" : "left-4";
  const threadRail = depth === 1 ? "-left-[18px] sm:-left-5" : "-left-4";
  const threadRailWidth = depth === 1 ? "w-[18px] sm:w-5" : "w-4";
  const threadStemTop = depth === 0 ? "top-5 sm:top-[22px]" : "top-[18px]";
  // Soft-deleted comments stay in the tree as a placeholder so the replies
  // underneath them keep their place. Everything about the original author is
  // hidden: no avatar, no name, no profile link — just "Комментарий удалён".
  const isDeleted = Boolean(comment.is_deleted);
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

  const replyAuthorName = depth > 0 && !isDeleted ? (comment.author.display_name || comment.author.username) : null;
  const childrenId = `wall-comment-children-${comment.id}`;  return (
    <div
      data-wall-comment-node="true"
      data-comment-id={comment.id}
      className={`relative ${isHighlighted ? "animate-in slide-in-from-bottom-3 fade-in duration-500 ease-out motion-reduce:animate-none" : ""}`}
    >
      {/* Elbow from the parent rail into this reply's avatar (avatar center sits
          at y=28 from the node top: 10px row padding + 2px link margin + 16px). */}
      {depth > 0 && (
        <div
          aria-hidden="true"
          data-wall-thread-connection="true"
          className={`pointer-events-none absolute ${threadRail} top-0 ${threadRailWidth} h-7 rounded-bl-xl border-b-2 border-l-2 border-border/55`}
        />
      )}
      {/* Continuation runs along the PARENT rail only, from this avatar center
          down to the next sibling — never along this reply's own axis. */}
      {depth > 0 && !isLast && (
        <div
          aria-hidden="true"
          data-wall-thread-continuation="true"
          className={`pointer-events-none absolute ${threadRail} top-7 bottom-0 z-0 border-l-2 border-border/55`}
        />
      )}
      <div
        data-wall-highlighted={isHighlighted ? "true" : undefined}
        className={`group relative z-10 rounded-2xl py-2.5 transition-[background-color,box-shadow,color] duration-500 motion-reduce:transition-none hover:bg-muted/20 ${isHighlighted ? "bg-primary/[0.03] ring-1 ring-primary/15" : ""}`}
      >
          <div className="relative flex items-start gap-3">
            {hasChildren && (
              <div
                aria-hidden="true"
                data-wall-thread-parent-stem="true"
                className={`pointer-events-none absolute ${threadAxis} ${threadStemTop} bottom-[-14px] z-0 origin-top border-l-2 border-border/55 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${isCollapsed ? "scale-y-0 opacity-0" : "scale-y-100 opacity-100"}`}
              />
            )}
            {isDeleted ? (
              <div className="relative z-10 mt-0.5 shrink-0">
                <Avatar data-wall-avatar="deleted" className={`${depth === 0 ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8"} border border-border/70 bg-muted shadow-sm`}>
                  <AvatarFallback className="bg-muted text-muted-foreground/70">
                    <Ghost className="h-4 w-4" aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
              </div>
            ) : (
              <Link
                to={`/profile/${comment.user_id}`}
                className="relative z-10 mt-0.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar data-wall-avatar="current" className={`${depth === 0 ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8"} border border-border/70 bg-muted shadow-sm`}>
                  <AvatarImage
                    src={avatarUrl || undefined}
                    alt={authorLabel}
                  />
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {authorLabel.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
            )}

            <div className="min-w-0 flex-1">
              {isDeleted ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium italic text-muted-foreground">Автор неизвестен</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(safeDate(comment.created_at), { locale: ru, addSuffix: true })}
                  </span>
                </div>
              ) : (
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
              )}

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
              ) : isDeleted ? (
                <div className="mt-1.5 text-sm italic leading-6 text-muted-foreground/70">Комментарий удалён</div>
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
                  {/* A soft-deleted comment is a read-only placeholder: no like,
                      reply, edit or delete — only the reply-branch toggle. */}
                  {!isDeleted && currentUserId && (
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

                  {!isDeleted && canReply && currentUserId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-7 gap-1 px-1.5 text-xs ${isReplying ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => (isReplying ? cancelReply() : startReply(comment.id))}
                      aria-pressed={isReplying}
                    >
                      <Reply className={`h-3.5 w-3.5 ${isReplying ? "fill-current" : ""}`} />
                      <span className="hidden sm:inline">{isReplying ? "Отменить" : "Ответить"}</span>
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

                  {!isDeleted && (canEdit || canDelete) && (                      <>
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
                {children.map((child, index) => {
                  const childChildren = tree.get(child.id) || [];
                  return (
                    <WallCommentNode
                      key={child.id}
                      comment={child}
                      children={childChildren}
                      tree={tree}
                      depth={isMaxDepth ? depth : depth + 1}
                      isLast={index === children.length - 1}
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
