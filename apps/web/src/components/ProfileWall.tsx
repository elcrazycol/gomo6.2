import { type ReactNode, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWallPost, type WallPost } from "@/components/CreateWallPost";
import { GomoRichEditor } from "@/components/GomoRichEditor";
import { ImageGallery } from "@/components/ImageGallery";
import { MediaPlayer } from "@/components/MediaPlayer";
import { ProcessedContent } from "@/components/ProcessedContent";
import { RichContentRenderer } from "@/components/RichContentRenderer";
import { UserBadge } from "@/components/UserBadge";
import { AttachmentMeta } from "@/types/forum";
import { EMPTY_EDITOR_STATE } from "@/utils/lexicalContent";
import { lexicalJsonToPlainText, normalizeLexicalContent } from "@/utils/lexicalContent";
import {
  Edit3,
  FileText,
  Heart,
  Loader2,
  MessageCircle,
  Pin,
  PinOff,
  Plus,
  Repeat2,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface ProfileWallProps {
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  canPost: boolean;
  showWall: boolean;
}

interface WallComment {
  id: string;
  post_id: string;
  user_id: string;
  content: string | null;
  content_json?: unknown;
  created_at: string;
  updated_at: string;
  author: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  };
}

const normalizeWallComment = (comment: any): WallComment => {
  const authorSource = Array.isArray(comment?.author) ? comment.author[0] : comment?.author;
  const contentJson = comment?.content_json ?? null;
  const content = typeof comment?.content === "string" && comment.content.trim().length > 0
    ? comment.content
    : lexicalJsonToPlainText(contentJson, "");

  return {
    id: comment.id,
    post_id: comment.post_id,
    user_id: comment.user_id,
    content,
    content_json: contentJson,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    author: {
      username: authorSource?.username || "user",
      is_anonymous: Boolean(authorSource?.is_anonymous),
      avatar_url: authorSource?.avatar_url || null,
    },
  };
};

const getRenderableCommentState = (comment: WallComment) =>
  normalizeLexicalContent(comment.content_json, comment.content || "");

const normalizeAttachments = (post: WallPost): AttachmentMeta[] => {
  if (Array.isArray(post.attachments) && post.attachments.length > 0) {
    return post.attachments;
  }
  if (post.image_url) {
    return [{
      url: post.image_url,
      type: "image",
      mime: "image/*",
      name: "wall-image",
      size: 0,
    }];
  }
  return [];
};

const ActionButton = ({
  icon,
  label,
  count,
  active = false,
  disabled = false,
  loading = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={onClick}
    disabled={disabled || loading}
    className={`h-9 rounded-full px-3 text-xs transition-colors sm:text-sm ${
      active ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground"
    }`}
  >
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    <span>{label}</span>
    <span className="text-foreground/80">{count}</span>
  </Button>
);

const WallAttachments = ({
  attachments,
  onImageClick,
  galleryKey,
}: {
  attachments: AttachmentMeta[];
  onImageClick: (images: string[], index: number) => void;
  galleryKey: string;
}) => {
  const imageUrls = attachments.filter((attachment) => attachment.type === "image").map((attachment) => attachment.url);

  return (
    <div className="space-y-3">
      {imageUrls.length > 1 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {imageUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              className="overflow-hidden border border-border/60 bg-muted/30"
              onClick={() => onImageClick(imageUrls, index)}
            >
              <img src={url} alt={`attachment-${index + 1}`} className="h-40 w-full object-cover transition-transform hover:scale-[1.02]" />
            </button>
          ))}
        </div>
      )}

      {attachments.map((attachment, index) => {
        if (attachment.type === "image" && imageUrls.length > 1) return null;

        if (attachment.type === "image") {
          return (
            <button
              key={`${galleryKey}-${index}`}
              type="button"
              className="block overflow-hidden border border-border/60 bg-muted/30"
              onClick={() => onImageClick(imageUrls, 0)}
            >
              <img src={attachment.url} alt={attachment.name || "attachment"} className="max-h-[32rem] w-full object-cover" />
            </button>
          );
        }

        if (attachment.type === "video") {
          return (
            <MediaPlayer
              key={`${galleryKey}-${index}`}
              kind="video"
              poster={attachment.poster}
              sources={[{ src: attachment.url, type: attachment.mime || "video/webm" }]}
              className="max-w-3xl"
            />
          );
        }

        if (attachment.type === "audio") {
          return (
            <MediaPlayer
              key={`${galleryKey}-${index}`}
              kind="audio"
              sources={[{ src: attachment.url, type: attachment.mime || "audio/ogg" }]}
              className="max-w-xl"
              playerId={`wall-audio-${galleryKey}-${index}`}
              title={attachment.name || "Аудио"}
              playlistId={`wall-${galleryKey}`}
              playlistIndex={index}
            />
          );
        }

        return (
          <a
            key={`${galleryKey}-${index}`}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-border/60 bg-background px-3 py-2 text-sm text-primary"
          >
            <FileText className="h-4 w-4" />
            <span className="max-w-[18rem] truncate">{attachment.name || attachment.url}</span>
          </a>
        );
      })}
    </div>
  );
};

const WallPostCard = ({
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
}: {
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
}) => {
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
          supabase.from("profile_wall_post_likes").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          supabase.from("profile_wall_post_comments").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          supabase.from("profile_wall_post_reposts").select("id", { count: "exact", head: true }).eq("post_id", post.id),
          currentUserId
            ? supabase.from("profile_wall_post_likes").select("id").eq("post_id", post.id).eq("user_id", currentUserId).maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),
          currentUserId
            ? supabase
                .from("profile_wall_post_reposts")
                .select("id, reposted_wall_post_id")
                .eq("post_id", post.id)
                .eq("user_id", currentUserId)
                .eq("wall_user_id", currentUserId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),
        ]);

        setLikesCount(likesCountResult.count || 0);
        setCommentsCount(commentsCountResult.count || 0);
        setRepostsCount(repostsCountResult.count || 0);
        setIsLiked(Boolean((likeStateResult as any).data));
        setIsReposted(Boolean((repostStateResult as any).data));
        setRepostRecordId((repostStateResult as any).data?.id || null);
        setRepostedWallPostId((repostStateResult as any).data?.reposted_wall_post_id || null);
      } catch (error) {
        console.error("Error loading wall interaction state:", error);
      }
    };

    loadInteractionState();
  }, [currentUserId, post.id]);

  const loadComments = async () => {
    try {
      setCommentsLoading(true);
      const { data, error } = await (supabase as any)
        .from("profile_wall_post_comments")
        .select(`
          id,
          post_id,
          user_id,
          content,
          content_json,
          created_at,
          updated_at,
          author:profiles!user_id (
            username,
            is_anonymous,
            avatar_url
          )
        `)
        .eq("post_id", post.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setComments(((data || []) as any[]).map(normalizeWallComment));
    } catch (error) {
      console.error("Error loading wall comments:", error);
      toast.error("Не удалось загрузить комментарии");
    } finally {
      setCommentsLoading(false);
    }
  };

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
        const { error } = await supabase
          .from("profile_wall_post_likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUserId);

        if (error) throw error;

        setIsLiked(false);
        setLikesCount((prev) => Math.max(0, prev - 1));
      } else {
        const { error } = await supabase
          .from("profile_wall_post_likes")
          .insert({
            post_id: post.id,
            user_id: currentUserId,
          });

        if (error) throw error;

        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
      }
    } catch (error) {
      console.error("Error toggling wall like:", error);
      toast.error("Не удалось изменить лайк");
    } finally {
      setIsLiking(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!currentUserId || isSubmittingComment) return;

    const normalizedCommentJson = normalizeLexicalContent(commentJson, commentText);
    const normalizedCommentText = lexicalJsonToPlainText(normalizedCommentJson, commentText);
    const hasText = normalizedCommentText.trim().length > 0;
    if (!hasText) {
      toast.error("Напишите комментарий");
      return;
    }

    setIsSubmittingComment(true);
    try {
      const { data, error } = await (supabase as any)
        .from("profile_wall_post_comments")
        .insert({
          post_id: post.id,
          user_id: currentUserId,
          content: normalizedCommentText,
          content_json: normalizedCommentJson,
        })
        .select(`
          id,
          post_id,
          user_id,
          content,
          content_json,
          created_at,
          updated_at,
          author:profiles!user_id (
            username,
            is_anonymous,
            avatar_url
          )
        `)
        .single();

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

    setIsReposting(true);
    try {
      if (isReposted && repostRecordId) {
        if (repostedWallPostId) {
          const { error: repostedPostDeleteError } = await supabase
            .from("profile_wall_posts")
            .delete()
            .eq("id", repostedWallPostId)
            .eq("author_id", currentUserId);

          if (repostedPostDeleteError) throw repostedPostDeleteError;
        }

        const { error } = await supabase
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
      }

      const repostTitle = post.title?.trim() ? `Репост: ${post.title}` : "Репост на стене";
      const { data: repostedPost, error: repostedPostError } = await (supabase as any)
        .from("profile_wall_posts")
        .insert({
          user_id: currentUserId,
          author_id: currentUserId,
          title: repostTitle,
          content: post.content,
          content_json: post.content_json,
          image_url: post.image_url,
          attachments: post.attachments || null,
          repost_of_post_id: post.id,
        })
        .select("id")
        .single();

      if (repostedPostError) throw repostedPostError;

      const { data: repostRecord, error: repostRecordError } = await (supabase as any)
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
      toast.success(currentUserId === profileUserId ? "Репост появился у вас на стене" : "Репост отправлен на вашу стену");

      if (currentUserId === profileUserId) {
        await onRefreshPosts();
      }
    } catch (error: any) {
      console.error("Error toggling wall repost:", error);
      if (error?.code === "23505") {
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
    setEditingCommentJson(normalizeLexicalContent(comment.content_json, comment.content || ""));
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

    const normalizedEditJson = normalizeLexicalContent(editingCommentJson, editingCommentText);
    const normalizedEditText = lexicalJsonToPlainText(normalizedEditJson, editingCommentText);

    if (!normalizedEditText.trim()) {
      toast.error("Напишите комментарий");
      return;
    }

    setIsSavingCommentEdit(true);
    try {
      const { error } = await supabase
        .from("profile_wall_post_comments")
        .update({
          content: normalizedEditText,
          content_json: normalizedEditJson,
        })
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
      const { error } = await supabase
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
                  isAnonymous={post.author.is_anonymous}
                  disableLink={false}
                />
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(post.created_at), {
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
                {(post as any).repost_of_post_id && (
                  <span className="inline-flex items-center gap-1 border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <Repeat2 className="h-3.5 w-3.5" />
                    Репост на стене
                  </span>
                )}
              </div>

              {(post.content || post.content_json) && (
                <div className="mt-2 break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
                  <ProcessedContent content={post.content || ""} contentJson={post.content_json} currentUserId={currentUserId} isAdmin={false} currentUsername={currentUsername} />
                </div>
              )}
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

        {attachments.length > 0 && (
          <WallAttachments
            attachments={attachments}
            galleryKey={post.id}
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
            label="Комментировать"
            count={commentsCount}
            active={commentsOpen}
            onClick={handleToggleComments}
          />
          <ActionButton
            icon={<Repeat2 className="h-4 w-4" />}
            label="Репост"
            count={repostsCount}
            active={isReposted}
            disabled={!currentUserId}
            loading={isReposting}
            onClick={handleRepostToggle}
          />
        </div>

        {commentsOpen && (
          <div className="space-y-3 border-t border-border/60 pt-4">
            {currentUserId && (
              <div className="space-y-3 border border-border/60 bg-muted/[0.16] p-3">
                <GomoRichEditor
                  resetKey={commentResetKey}
                  contentJson={commentJson}
                  legacyContent={commentText}
                  onChange={({ json, text }) => {
                    setCommentJson(json);
                    setCommentText(text);
                  }}
                  onSubmit={handleSubmitComment}
                  placeholder="Напишите комментарий"
                  minHeightClassName="min-h-[84px]"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {commentsCount > 0 ? `${commentsCount} комментариев` : "Пока без комментариев"}
                  </div>
                  <Button type="button" onClick={handleSubmitComment} disabled={isSubmittingComment || commentText.trim().length === 0}>
                    {isSubmittingComment ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Отправляем
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Ответить
                      </>
                    )}
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
                        <UserBadge
                          userId={comment.user_id}
                          username={comment.author.username}
                          isAnonymous={comment.author.is_anonymous}
                          disableLink={false}
                        />
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(comment.created_at), {
                            locale: ru,
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      {(currentUserId === comment.user_id || currentUserId === post.user_id) && (
                        <div className="flex items-center gap-1">
                          {currentUserId === comment.user_id && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleStartCommentEdit(comment)}
                              title="Редактировать комментарий"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteComment(comment.id)}
                            disabled={deletingCommentId === comment.id}
                            title="Удалить комментарий"
                          >
                            {deletingCommentId === comment.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
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
                          onChange={({ json, text }) => {
                            setEditingCommentJson(json);
                            setEditingCommentText(text);
                          }}
                          onSubmit={handleSaveCommentEdit}
                          placeholder="Измените комментарий"
                          minHeightClassName="min-h-[84px]"
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={handleCancelCommentEdit}>
                            Отмена
                          </Button>
                          <Button type="button" onClick={handleSaveCommentEdit} disabled={isSavingCommentEdit}>
                            {isSavingCommentEdit ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Сохраняем
                              </>
                            ) : (
                              "Сохранить"
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="break-words text-sm leading-6 sm:text-[15px]">
                        {(() => {
                          const renderState = getRenderableCommentState(comment);
                          const renderText = lexicalJsonToPlainText(renderState, comment.content || "");

                          if (renderText.trim().length > 0) {
                            return <RichContentRenderer contentJson={renderState} />;
                          }

                          if ((comment.content || "").trim().length > 0) {
                            return <span className="whitespace-pre-wrap">{comment.content}</span>;
                          }

                          return <span className="text-muted-foreground">(пустой комментарий)</span>;
                        })()}
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
    </Card>
  );
};

export const ProfileWall = ({
  profileUserId,
  currentUserId,
  currentUsername,
  canPost,
  showWall,
}: ProfileWallProps) => {
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const activeEditingPost = useMemo(
    () => posts.find((post) => post.id === editingPost),
    [editingPost, posts]
  );

  useEffect(() => {
    if (showWall) {
      loadPosts();
    }
  }, [profileUserId, showWall]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("profile_wall_posts")
        .select(`
          id,
          user_id,
          author_id,
          title,
          content,
          content_json,
          image_url,
          attachments,
          repost_of_post_id,
          created_at,
          updated_at,
          is_pinned,
          pinned_order,
          author:profiles!author_id (
            username,
            is_anonymous,
            avatar_url
          )
        `)
        .eq("user_id", profileUserId)
        .order("is_pinned", { ascending: false })
        .order("pinned_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPosts((data || []) as WallPost[]);
    } catch (error) {
      console.error("Error loading wall posts:", error);
      toast.error("Ошибка загрузки постов стены");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!currentUserId) return;

    try {
      const { error } = await supabase
        .from("profile_wall_posts")
        .delete()
        .eq("id", postId)
        .or(`author_id.eq.${currentUserId},user_id.eq.${currentUserId}`);

      if (error) throw error;

      setPosts((prev) => prev.filter((post) => post.id !== postId));
      toast.success("Пост удален");
    } catch (error) {
      console.error("Error deleting post:", error);
      toast.error("Ошибка удаления поста");
    }
  };

  const handleTogglePin = async (postId: string) => {
    if (!currentUserId) return;

    try {
      const { data, error } = await supabase.rpc("toggle_wall_post_pin", {
        _post_id: postId,
        _user_id: currentUserId,
      });

      if (error) throw error;

      if (!data) {
        toast.error("У вас нет прав на закрепление этого поста");
        return;
      }

      await loadPosts();
      toast.success("Статус закрепления изменен");
    } catch (error) {
      console.error("Error toggling pin:", error);
      toast.error("Ошибка изменения закрепления");
    }
  };

  const handlePostCreated = (newPost: WallPost) => {
    setPosts((prev) => [newPost, ...prev]);
    setShowCreateForm(false);
  };

  const handlePostUpdated = (updatedPost: WallPost) => {
    setPosts((prev) => prev.map((post) => (post.id === updatedPost.id ? updatedPost : post)));
    setEditingPost(null);
  };

  if (!showWall) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-14 rounded-3xl bg-muted" />
          <div className="h-40 rounded-3xl bg-muted" />
          <div className="h-40 rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {canPost && (
          <div className="flex justify-end">
            <div className="relative w-full max-w-3xl">
              <div className={`flex ${showCreateForm ? "justify-start" : "justify-end"} transition-all duration-300 ease-out`}>
                <Button
                  variant="default"
                  size="icon"
                  onClick={() => {
                    setEditingPost(null);
                    setShowCreateForm((prev) => !prev);
                  }}
                  className={`z-20 h-12 w-12 rounded-2xl text-xl shadow-lg transition-all duration-300 ease-out ${
                    showCreateForm ? "absolute right-4 top-0" : "relative"
                  }`}
                  title={showCreateForm ? "Скрыть форму" : "Написать на стене"}
                >
                  <Plus className={`h-5 w-5 transition-transform duration-300 ease-out ${showCreateForm ? "rotate-45" : "rotate-0"}`} />
                </Button>
              </div>

              <div
                className={`origin-top-right overflow-hidden transition-all duration-300 ease-out ${
                  showCreateForm && currentUserId
                    ? "max-h-[1200px] translate-y-0 opacity-100"
                    : "pointer-events-none max-h-0 -translate-y-2 opacity-0"
                }`}
              >
                <div className="pt-3">
                  {currentUserId && (
                    <CreateWallPost
                      key={showCreateForm ? "wall-create-open" : "wall-create-closed"}
                      profileUserId={profileUserId}
                      currentUserId={currentUserId}
                      onPostCreated={handlePostCreated}
                      onCancel={() => setShowCreateForm(false)}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {posts.length === 0 ? (
          <div className="border border-dashed border-border/70 bg-muted/20 py-12 text-center">
            <p className="text-lg font-medium">На стене пока тихо</p>
            {canPost && <p className="mt-2 text-sm text-muted-foreground">Нажмите `+`, чтобы оставить первую запись.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <WallPostCard
                key={post.id}
                post={post}
                profileUserId={profileUserId}
                currentUserId={currentUserId}
                currentUsername={currentUsername}
                currentProfileUsername={currentUsername}
                isEditing={editingPost === post.id && currentUserId !== null && activeEditingPost?.id === post.id}
                onStartEditing={() => setEditingPost(post.id)}
                onCancelEditing={() => setEditingPost(null)}
                onPostUpdated={handlePostUpdated}
                onDeletePost={handleDeletePost}
                onTogglePin={handleTogglePin}
                onRefreshPosts={loadPosts}
                onImageClick={(images, index) => {
                  setGalleryImages(images);
                  setGalleryIndex(index);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {galleryImages && (
        <ImageGallery
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setGalleryImages(null)}
        />
      )}
    </>
  );
};
