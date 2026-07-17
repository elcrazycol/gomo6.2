import { type ReactNode, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import {
  Copy, Edit3, Heart, Loader2, MessageCircle, Pin, PinOff,
  Repeat2, Send, Share2, Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { GomoRichEditor } from "@/components/GomoRichEditor";
import { CreateWallPost } from "@/components/CreateWallPost";
import { ActionButton } from "@/components/WallActionButton";
import { WallAttachments } from "@/components/WallAttachments";
import { EmbeddedWallPost } from "@/components/WallEmbeddedPost";
import {
  type WallPost, type WallComment,
  normalizeWallPostAuthor, normalizeWallPostRecord, normalizeWallComment,
  normalizeAttachments, isInteractiveTarget, getWallPostPath,
} from "@/utils/wallNormalizers";
import { EMPTY_EDITOR_STATE } from "@/utils/lexicalContent";
import { normalizeContent, prosemirrorToPlainText } from "@/utils/contentConverter";
import { safeDate } from "@/utils/safeDate";

interface WallPostCardProps {
  post: WallPost;
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  currentProfileUsername: string;
  isEditing: boolean;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onPostUpdated: (post: WallPost) => void;
  onDeletePost: (postId: string) => void;
  onTogglePin: (postId: string) => void;
  onRefreshPosts: () => Promise<void>;
  onImageClick: (images: string[], index: number) => void;
  forceCommentsOpen?: boolean;
  postHref?: string | null;
  standalone?: boolean;
}

export const WallPostCard = ({
  post,
  profileUserId,
  currentUserId,
  currentUsername,
  currentProfileUsername,
  isEditing,
  onStartEditing,
  onCancelEditing,
  onPostUpdated,
  onDeletePost,
  onTogglePin,
  onRefreshPosts,
  onImageClick,
  forceCommentsOpen = false,
  postHref,
  standalone = false,
}: WallPostCardProps) => {
  const navigate = useNavigate();
  const attachments = useMemo(() => normalizeAttachments(post), [post]);
  const canManage = currentUserId === post.author_id || currentUserId === post.user_id;
  const [likesCount, setLikesCount] = useState(0);
  const [commentsCount, setCommentsCount] = useState(0);
  const [repostsCount, setRepostsCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isReposted, setIsReposted] = useState(false);
  const [repostRecordId, setRepostRecordId] = useState<string | null>(null);
  const [repostedWallPostId, setRepostedWallPostId] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<WallComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentJson, setCommentJson] = useState<unknown>(EMPTY_EDITOR_STATE);
  const [commentResetKey, setCommentResetKey] = useState(0);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [editingCommentJson, setEditingCommentJson] = useState<unknown>(EMPTY_EDITOR_STATE);
  const [editingCommentResetKey, setEditingCommentResetKey] = useState(0);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSavingCommentEdit, setIsSavingCommentEdit] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [isLiking, setIsLiking] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [repostComposerOpen, setRepostComposerOpen] = useState(false);
  const [repostText, setRepostText] = useState("");
  const [repostJson, setRepostJson] = useState<unknown>(EMPTY_EDITOR_STATE);
  const [repostResetKey, setRepostResetKey] = useState(0);

  const loadComments = useCallback(async () => {
    try {
      setCommentsLoading(true);
      const { data, error } = await api
        .from("profile_wall_post_comments")
        .select(`\n          id,\n          post_id,\n          user_id,\n          content,\n          content_json,\n          created_at,\n          updated_at,\n          author:profiles!user_id (\n            username,\n            is_anonymous,\n            avatar_url\n          )\n        `)
        .eq("post_id", post.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setComments(((data || []) as Record<string, unknown>[]).map(normalizeWallComment));
    } catch (err) {
      console.error("Error loading wall comments:", err);
      toast.error("Не удалось загрузить комментарии");
    } finally {
      setCommentsLoading(false);
    }
  }, [post.id]);

  useEffect(() => {
    if (!forceCommentsOpen || commentsOpen) return;
    setCommentsOpen(true);
    void loadComments();
  }, [forceCommentsOpen, commentsOpen, post.id, loadComments]);

  useEffect(() => {
    const loadInteractionState = async () => {
      try {
        const [
          likesCountResult,
          commentsCountResult,
          repostsCountResult,
          likeStateResult,
          repostStateResult,
        ] = await Promise.all([
          api.from("profile_wall_post_likes").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          api.from("profile_wall_post_comments").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          api.from("profile_wall_post_reposts").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          currentUserId
            ? api.from("profile_wall_post_likes").select("id").eq("post_id", post.id).eq("user_id", currentUserId).maybeSingle()
            : Promise.resolve({ data: null, error: null } as Record<string, unknown>),
          currentUserId
            ? api
                .from("profile_wall_post_reposts")
                .select("id, reposted_wall_post_id")
                .eq("post_id", post.id)
                .eq("user_id", currentUserId)
                .eq("wall_user_id", currentUserId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as Record<string, unknown>),
        ]);

        setLikesCount(likesCountResult.count || 0);
        setCommentsCount(commentsCountResult.count || 0);
        setRepostsCount(repostsCountResult.count || 0);
        setIsLiked(Boolean((likeStateResult as { data: unknown }).data));
        setIsReposted(Boolean((repostStateResult as { data: unknown }).data));
        setRepostRecordId((repostStateResult as { data: { id: string } | null }).data?.id || null);
        setRepostedWallPostId((repostStateResult as { data: { reposted_wall_post_id: string } | null }).data?.reposted_wall_post_id || null);
      } catch (error) {
        console.error("Error loading wall interaction state:", error);
      }
    };

    loadInteractionState();
  }, [currentUserId, post.id]);

  const handleToggleComments = async () => {
    const nextOpen = !commentsOpen;
    setCommentsOpen(nextOpen);
    if (nextOpen) {
      await loadComments();
    }
  };

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

  const handleSubmitComment = async () => {
    if (!currentUserId || isSubmittingComment) return;
    const normalizedCommentJson = normalizeContent(commentJson, commentText);
    const normalizedCommentText = prosemirrorToPlainText(normalizedCommentJson, "") || commentText;
    if (!normalizedCommentText.trim()) {
      toast.error("Напишите комментарий");
      return;
    }
    setIsSubmittingComment(true);
    try {
      const { error } = await api
        .from("profile_wall_post_comments")
        .insert({
          post_id: post.id,
          user_id: currentUserId,
          content: normalizedCommentText,
          content_json: normalizedCommentJson,
        });
      if (error) throw error;
      setCommentsOpen(true);
      await loadComments();
      setCommentsCount((prev) => prev + 1);
      setCommentText("");
      setCommentJson(EMPTY_EDITOR_STATE);
      setCommentResetKey((prev) => prev + 1);
    } catch (error) {
      console.error("Error creating wall comment:", error);
      toast.error("Не удалось отправить комментарий");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleRepostToggle = async () => {
    if (!currentUserId || isReposting) return;
    if (isReposted && repostRecordId) {
      setIsReposting(true);
      try {
        if (repostedWallPostId) {
          const { error: repostedPostDeleteError } = await api
            .from("profile_wall_posts")
            .delete()
            .eq("id", repostedWallPostId)
            .eq("author_id", currentUserId);
          if (repostedPostDeleteError) throw repostedPostDeleteError;
        }
        const { error } = await api
          .from("profile_wall_post_reposts")
          .delete()
          .eq("id", repostRecordId)
          .eq("user_id", currentUserId)
          .eq("wall_user_id", currentUserId);
        if (error) throw error;
        setIsReposted(false);
        setRepostRecordId(null);
        setRepostedWallPostId(null);
        setRepostsCount((prev) => Math.max(0, prev - 1));
        if (currentUserId === profileUserId) {
          await onRefreshPosts();
        }
        return;
      } catch (error: unknown) {
        console.error("Error toggling wall repost:", error);
        if ((error as { code?: string })?.code === "23505") {
          toast.error("Вы уже репостнули эту запись к себе");
        } else {
          toast.error("Не удалось выполнить репост");
        }
      } finally {
        setIsReposting(false);
      }
      return;
    }
    setRepostText("");
    setRepostJson(EMPTY_EDITOR_STATE);
    setRepostResetKey((prev) => prev + 1);
    setRepostComposerOpen(true);
  };

  const handleSharePost = async () => {
    setShareDialogOpen(true);
  };

  const sharePath = getWallPostPath(post.user_id, post.id);
  const shareUrl = `${window.location.origin}${sharePath}`;

  const handleCopyShareUrl = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Ссылка на запись скопирована");
    } catch {
      toast.error("Не удалось скопировать ссылку");
    } finally {
      setIsSharing(false);
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share || isSharing) return;
    setIsSharing(true);
    try {
      await navigator.share({
        title: post.title || "Пост на стене",
        text: post.content || "Посмотри эту запись",
        url: shareUrl,
      });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error("Не удалось поделиться записью");
      }
    } finally {
      setIsSharing(false);
    }
  };

  const encodedShareUrl = encodeURIComponent(shareUrl);
  const encodedShareText = encodeURIComponent(post.content || post.title || "Посмотри эту запись");

  const handleSubmitRepost = async () => {
    if (!currentUserId || isReposting) return;
    setIsReposting(true);
    try {
      const repostTitleSource = repostText.trim() || post.title || "Репост на стене";
      const { data: repostedPost, error: repostedPostError } = await api
        .from("profile_wall_posts")
        .insert({
          user_id: currentUserId,
          author_id: currentUserId,
          title: repostTitleSource.length > 80 ? `${repostTitleSource.slice(0, 77).trimEnd()}...` : repostTitleSource,
          content: repostText.trim() || null,
          content_json: repostText.trim().length > 0 ? repostJson : null,
          image_url: null,
          attachments: null,
          repost_of_post_id: post.id,
        })
        .select("id")
        .single();
      if (repostedPostError) throw repostedPostError;

      const { data: repostRecord, error: repostRecordError } = await api
        .from("profile_wall_post_reposts")
        .insert({
          post_id: post.id,
          user_id: currentUserId,
          wall_user_id: currentUserId,
          reposted_wall_post_id: repostedPost.id,
        })
        .select("id, reposted_wall_post_id")
        .single();
      if (repostRecordError) throw repostRecordError;

      setIsReposted(true);
      setRepostRecordId(repostRecord.id);
      setRepostedWallPostId(repostRecord.reposted_wall_post_id || repostedPost.id);
      setRepostsCount((prev) => prev + 1);
      setRepostComposerOpen(false);
      setRepostText("");
      setRepostJson(EMPTY_EDITOR_STATE);
      toast.success(currentUserId === profileUserId ? "Репост появился у вас на стене" : "Репост отправлен на вашу стену");
      if (currentUserId === profileUserId) {
        await onRefreshPosts();
      }
    } catch (err: unknown) {
      console.error("Error creating wall repost:", err);
      if ((err as { code?: string })?.code === "23505") {
        toast.error("Вы уже репостнули эту запись к себе");
      } else {
        toast.error("Не удалось выполнить репост");
      }
    } finally {
      setIsReposting(false);
    }
  };

  const handleStartCommentEdit = (comment: WallComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentText(comment.content || "");
    setEditingCommentJson(comment.content_json ?? null);
    setEditingCommentResetKey((prev) => prev + 1);
  };

  const handleCancelCommentEdit = () => {
    setEditingCommentId(null);
    setEditingCommentText("");
    setEditingCommentJson(EMPTY_EDITOR_STATE);
    setEditingCommentResetKey((prev) => prev + 1);
  };

  const handleSaveCommentEdit = async () => {
    if (!editingCommentId || isSavingCommentEdit) return;
    const normalizedEditJson = normalizeContent(editingCommentJson, editingCommentText);
    const normalizedEditText = prosemirrorToPlainText(normalizedEditJson, "") || editingCommentText;
    if (!normalizedEditText.trim()) {
      toast.error("Напишите комментарий");
      return;
    }
    setIsSavingCommentEdit(true);
    try {
      const { error } = await api
        .from("profile_wall_post_comments")
        .update({ content: normalizedEditText, content_json: normalizedEditJson })
        .eq("id", editingCommentId)
        .eq("user_id", currentUserId);
      if (error) throw error;
      await loadComments();
      handleCancelCommentEdit();
      toast.success("Комментарий обновлён");
    } catch (error) {
      console.error("Error updating wall comment:", error);
      toast.error("Не удалось обновить комментарий");
    } finally {
      setIsSavingCommentEdit(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!currentUserId || deletingCommentId) return;
    setDeletingCommentId(commentId);
    try {
      const { error } = await api
        .from("profile_wall_post_comments")
        .delete()
        .eq("id", commentId);
      if (error) throw error;
      setComments((prev) => prev.filter((comment) => comment.id !== commentId));
      setCommentsCount((prev) => Math.max(0, prev - 1));
      if (editingCommentId === commentId) {
        handleCancelCommentEdit();
      }
      toast.success("Комментарий удалён");
    } catch (error) {
      console.error("Error deleting wall comment:", error);
      toast.error("Не удалось удалить комментарий");
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleOpenPost = (event: ReactMouseEvent<HTMLElement>) => {
    if (!postHref || isEditing || isInteractiveTarget(event.target, event.currentTarget)) return;
    navigate(postHref);
  };

  return (
    <Card
      className={`overflow-hidden border-border/70 shadow-none ${
        post.is_pinned ? "border-primary/30 bg-primary/[0.03]" : "bg-background"
      }`}
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
                {post.is_pinned && (
                  <span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Pin className="h-3.5 w-3.5" />
                    Закреплено
                  </span>
                )}
                {!!(post.repost_of_post_id) && (
                  <span className="inline-flex items-center gap-1 border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <Repeat2 className="h-3.5 w-3.5" />
                    Репост на стене
                  </span>
                )}
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              {currentUserId === post.user_id && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onTogglePin(post.id)}
                  className="h-8 w-8"
                  title={post.is_pinned ? "Открепить пост" : "Закрепить пост"}
                >
                  {post.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </Button>
              )}
              {currentUserId === post.author_id && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onStartEditing}
                  className="h-8 w-8"
                  title="Редактировать"
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDeletePost(post.id)}
                className="h-8 w-8 text-destructive hover:text-destructive"
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div
          className={`${postHref && !isEditing ? "cursor-pointer" : ""}`}
          onClick={handleOpenPost}
          role={postHref && !isEditing ? "button" : undefined}
          tabIndex={postHref && !isEditing ? 0 : undefined}
        >
          {post.content?.trim() && (
            <div className="mb-4 break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
              <ProcessedContent content={(post.content as string) || ""} contentJson={post.content_json} currentUserId={currentUserId} isAdmin={false} currentUsername={currentUsername} />
            </div>
          )}

          {attachments.length > 0 && (
            <WallAttachments attachments={attachments} galleryKey={post.id} onImageClick={onImageClick} />
          )}

          {post.original_post && (
            <div className={attachments.length > 0 ? "mt-4" : ""}>
              <EmbeddedWallPost
                post={post.original_post}
                currentUserId={currentUserId}
                currentUsername={currentUsername}
                onImageClick={onImageClick}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <ActionButton icon={<Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />} label="Нравится" count={likesCount} active={isLiked} disabled={!currentUserId} loading={isLiking} onClick={handleLikeToggle} />
          <ActionButton icon={<MessageCircle className="h-4 w-4" />} label="Комментировать" count={commentsCount} active={commentsOpen} onClick={handleToggleComments} />
          <ActionButton icon={<Repeat2 className="h-4 w-4" />} label={isReposted ? "Убрать" : "Репост"} count={repostsCount} active={isReposted} disabled={!currentUserId} loading={isReposting} onClick={handleRepostToggle} />
          <ActionButton icon={<Share2 className="h-4 w-4" />} label="Поделиться" showLabel={false} active={false} disabled={false} loading={isSharing} onClick={handleSharePost} />
        </div>

        {commentsOpen && (
          <div className="space-y-3 border-t border-border/60 pt-4">
            {currentUserId && (
              <div className="space-y-3 border border-border/60 bg-muted/[0.16] p-3">
                <GomoRichEditor
                  resetKey={commentResetKey}
                  contentJson={commentJson}
                  legacyContent={commentText}
                  onChange={({ json, text }) => { setCommentJson(json); setCommentText(text); }}
                  onSubmit={handleSubmitComment}
                  placeholder="Напишите комментарий"
                  minHeightClassName="min-h-[84px]"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {commentsCount > 0 ? `${commentsCount} комментариев` : "Пока без комментариев"}
                  </div>
                  <Button type="button" onClick={handleSubmitComment} disabled={isSubmittingComment || commentText.trim().length === 0}>
                    {isSubmittingComment ? (<><Loader2 className="h-4 w-4 animate-spin" />Отправляем</>) : (<><Send className="h-4 w-4" />Ответить</>)}
                  </Button>
                </div>
              </div>
            )}

            {commentsLoading ? (
              <div className="py-3 text-sm text-muted-foreground">Загружаем комментарии…</div>
            ) : comments.length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">Тут пока пусто, но это можно исправить.</div>
            ) : (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <div key={comment.id} className="border border-border/60 bg-background p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <UserBadge userId={comment.user_id} username={comment.author.username} displayName={comment.author.display_name} isAnonymous={comment.author.is_anonymous} disableLink={false} />
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(safeDate(comment.created_at), { locale: ru, addSuffix: true })}
                        </span>
                      </div>
                      {(currentUserId === comment.user_id || currentUserId === post.user_id) && (
                        <div className="flex items-center gap-1">
                          {currentUserId === comment.user_id && (
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStartCommentEdit(comment)} title="Редактировать комментарий">
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button" variant="ghost" size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteComment(comment.id)}
                            disabled={deletingCommentId === comment.id}
                            title="Удалить комментарий"
                          >
                            {deletingCommentId === comment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingCommentId === comment.id ? (
                      <div className="space-y-3">
                        <GomoRichEditor
                          resetKey={editingCommentResetKey}
                          contentJson={editingCommentJson}
                          legacyContent={editingCommentText}
                          onChange={({ json, text }) => { setEditingCommentJson(json); setEditingCommentText(text); }}
                          onSubmit={handleSaveCommentEdit}
                          placeholder="Измените комментарий"
                          minHeightClassName="min-h-[84px]"
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={handleCancelCommentEdit}>Отмена</Button>
                          <Button type="button" onClick={handleSaveCommentEdit} disabled={isSavingCommentEdit}>
                            {isSavingCommentEdit ? (<><Loader2 className="h-4 w-4 animate-spin" />Сохраняем</>) : "Сохранить"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="break-words text-sm leading-6 sm:text-[15px]">
                        <ProcessedContent content={comment.content || ""} contentJson={comment.content_json as unknown} currentUserId={currentUserId} isAdmin={false} currentUsername={currentUsername} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isEditing && currentUserId && (
          <CreateWallPost
            key={`wall-edit-${post.id}-${post.updated_at}`}
            profileUserId={profileUserId}
            currentUserId={currentUserId}
            editingPost={post}
            onPostUpdated={onPostUpdated}
            onCancel={onCancelEditing}
          />
        )}
      </CardContent>

      <Dialog open={repostComposerOpen} onOpenChange={setRepostComposerOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-0 border-border/70 bg-background p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border/60 px-4 py-3 sm:px-5">
            <DialogTitle className="text-base">Репост записи</DialogTitle>
            <DialogDescription className="text-sm">Добавь подпись сверху или просто выкладывай оригинал как есть.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[72vh] space-y-4 overflow-y-auto p-3 sm:max-h-[78vh] sm:p-5">
            <div className="border border-border/70 bg-background p-3">
              <GomoRichEditor
                resetKey={repostResetKey}
                contentJson={repostJson}
                legacyContent={repostText}
                onChange={({ json, text }) => { setRepostJson(json); setRepostText(text); }}
                onSubmit={handleSubmitRepost}
                placeholder="Добавь подпись к репосту, если хочешь"
                minHeightClassName="min-h-[100px] sm:min-h-[120px]"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Оригинальная запись</div>
              <EmbeddedWallPost post={post.original_post || post} currentUserId={currentUserId} currentUsername={currentUsername} onImageClick={onImageClick} />
            </div>
          </div>
          <DialogFooter className="border-t border-border/60 px-3 py-3 sm:px-5">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setRepostComposerOpen(false)}>Отмена</Button>
            <Button type="button" className="w-full sm:w-auto" onClick={handleSubmitRepost} disabled={isReposting}>
              {isReposting ? (<><Loader2 className="h-4 w-4 animate-spin" />Публикуем</>) : "Выложить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-w-md border-border/70 bg-background">
          <DialogHeader><DialogTitle>Поделиться записью</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">{shareUrl}</div>
            <div className="grid grid-cols-2 gap-2">
              {typeof navigator.share !== 'undefined' && (
                <Button type="button" variant="outline" onClick={handleNativeShare} disabled={isSharing}><Share2 className="mr-2 h-4 w-4" />Системно</Button>
              )}
              <Button type="button" variant="outline" onClick={handleCopyShareUrl} disabled={isSharing}><Copy className="mr-2 h-4 w-4" />Копировать</Button>
              <a href={`https://t.me/share/url?url=${encodedShareUrl}&text=${encodedShareText}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">Telegram</a>
              <a href={`https://twitter.com/intent/tweet?url=${encodedShareUrl}&text=${encodedShareText}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">X</a>
              <a href={`https://vk.com/share.php?url=${encodedShareUrl}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">VK</a>
              <a href={`mailto:?subject=${encodeURIComponent(post.title || "Пост на стене")}&body=${encodedShareText}%0A%0A${encodedShareUrl}`} className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">Email</a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
