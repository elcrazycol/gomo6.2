import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import {
  Copy, Edit3, Heart, Loader2, MessageCircle, Pin, PinOff,
  Repeat2, Share2, Trash2,
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
import type { LightboxItem } from "@/components/Lightbox";
import { WallCommentTree } from "@/components/wall/WallCommentTree";
import {
  type WallPost,
  normalizeAttachments, isInteractiveTarget, getWallPostPath,
} from "@/utils/wallNormalizers";
import { EMPTY_EDITOR_STATE } from "@/utils/contentConverter";
import { safeDate } from "@/utils/safeDate";
import { COMMENTS_TARGET_FRACTION, shouldScrollToComments, smoothScrollToElement } from "@/utils/smoothScroll";

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
  onImageClick: (items: LightboxItem[], index: number) => void;
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
  const [likesCount, setLikesCount] = useState(post.likes_count ?? 0);
  const [commentsCount, setCommentsCount] = useState(post.comments_count ?? 0);
  const [repostsCount, setRepostsCount] = useState(post.reposts_count ?? 0);
  const [isLiked, setIsLiked] = useState(Boolean(post.liked_by_viewer));
  const [isReposted, setIsReposted] = useState(Boolean(post.my_repost_record_id));
  const [repostRecordId, setRepostRecordId] = useState<string | null>(post.my_repost_record_id ?? null);
  const [repostedWallPostId, setRepostedWallPostId] = useState<string | null>(post.my_reposted_wall_post_id ?? null);
  const [commentsOpen, setCommentsOpen] = useState(forceCommentsOpen);
  // The comment tree mounts on the FIRST open and then stays mounted forever
  // (hidden via grid-rows). Remounting it on every toggle would refetch the
  // comments and flash the loading skeleton — the "ghost" under the feed.
  const [commentsMounted, setCommentsMounted] = useState(forceCommentsOpen);
  // Unfolds the section only once the first fetch has settled, so the very
  // first open shows real content (or the empty state), never a skeleton flash.
  // Always starts false (even for forceCommentsOpen) so deep links behave the
  // same way: the section unfolds the moment the fetch resolves.
  const [commentsReady, setCommentsReady] = useState(false);
  const commentsRef = useRef<HTMLDivElement>(null);
  // Skip the auto-scroll on the very first open (e.g. forceCommentsOpen on load).
  const initialMountRef = useRef(true);

  const handleCommentsReady = useCallback(() => {
    setCommentsReady(true);
  }, []);

  // When the user opens comments, gently nudge the page down so the comments
  // take a good chunk of the screen — but only if they start below the target
  // line. Already-low users are never moved, and we never scroll up.
  useEffect(() => {
    if (commentsOpen) {
      setCommentsMounted(true);
      return;
    }
    initialMountRef.current = false;
  }, [commentsOpen]);

  // The nudge runs the moment the section starts to unfold (no delay): the
  // grid row grows DOWNWARD, so the section's top edge — the only thing the
  // nudge measures — is already in its final place. The scroll and the unfold
  // therefore glide together as one motion.
  useEffect(() => {
    if (!commentsOpen || !commentsReady) return;
    if (initialMountRef.current) return;
    const el = commentsRef.current;
    if (!el) return;
    const viewportHeight = window.innerHeight;
    if (shouldScrollToComments(el, viewportHeight)) {
      smoothScrollToElement(el, {
        block: "start",
        margin: viewportHeight * COMMENTS_TARGET_FRACTION,
        duration: 650,
      });
    }
  }, [commentsOpen, commentsReady]);
  const [isLiking, setIsLiking] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [repostComposerOpen, setRepostComposerOpen] = useState(false);
  const [repostText, setRepostText] = useState("");
  const [repostJson, setRepostJson] = useState<unknown>(EMPTY_EDITOR_STATE);
  const [repostResetKey, setRepostResetKey] = useState(0);

  // Interaction state comes embedded in the wall GET response (likes_count,
  // comments_count, reposts_count, liked_by_viewer, my_repost_record_id,
  // my_reposted_wall_post_id). The previous version fired 5 requests per post
  // on mount — a 20-post wall cost 100 requests. WS-delivered posts have no
  // counts yet, so default to 0/false (correct for a brand-new post).

  const handleToggleComments = () => {
    setCommentsOpen((prev) => !prev);
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

  const handleSharePost = () => {
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

  const handleOpenPost = (event: ReactMouseEvent<HTMLElement>) => {
    if (!postHref || isEditing || isInteractiveTarget(event.target, event.currentTarget)) return;
    navigate(postHref);
  };

  return (
    <Card
      // overflow-clip keeps the rounded-corner clipping but does NOT create a
      // scroll container, so position:sticky works for the floating composer.
      className={`overflow-clip border-border/70 shadow-none ${
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
                  emojiId={post.author.nickname_emoji_id}
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
          <ActionButton icon={<MessageCircle className="h-4 w-4" />} label="Комментировать" count={commentsCount} active={commentsOpen} loading={commentsOpen && !commentsReady} onClick={handleToggleComments} />
          <ActionButton icon={<Repeat2 className="h-4 w-4" />} label={isReposted ? "Убрать" : "Репост"} count={repostsCount} active={isReposted} disabled={!currentUserId} loading={isReposting} onClick={handleRepostToggle} />
          <ActionButton icon={<Share2 className="h-4 w-4" />} label="Поделиться" showLabel={false} active={false} disabled={false} loading={isSharing} onClick={handleSharePost} />
        </div>

        {/*
          Expand/collapse via CSS grid rows (0fr → 1fr) instead of animating
          `height` in JS: the browser resolves the row height natively, which is
          smooth and never reflows the sticky composer inside.

          The tree mounts once (on the first open) and is then hidden with 0fr
          + invisible instead of being unmounted — so reopening never refetches
          or flashes the loading skeleton under the comments.
        */}
        {(commentsMounted || commentsOpen) && (
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${commentsOpen && commentsReady ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            {/* `invisible` when collapsed: 0fr clips visually, but the mounted
                tree (reply buttons, composer pill…) must not stay focusable
                while hidden. visibility transitions, flipping only at the end. */}
            <div
              ref={commentsRef}
              className={`min-h-0 overflow-clip transition-[opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${commentsOpen && commentsReady ? "opacity-100" : "invisible opacity-0"}`}
            >
              <WallCommentTree
                postId={post.id}
                postUserId={post.user_id}
                currentUserId={currentUserId}
                currentUsername={currentUsername}
                onCommentCountChange={(delta) => setCommentsCount((prev) => Math.max(0, prev + delta))}
                onFirstLoad={handleCommentsReady}
              />
            </div>
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
