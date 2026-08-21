import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ChevronDown, Edit3, Ellipsis, Ghost, Heart,
  Loader2, Reply, Trash2,
} from "lucide-react";

import { api } from "@/integrations/api/compat";
import { invalidateByPrefix } from "@/integrations/api/queryCache";
import { useDateLocale } from "@/i18n/dateLocale";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { isEditableElement } from "@/lib/mobileKeyboard";
import { safeDate } from "@/utils/safeDate";
import { storageUrl } from "@/utils/storage";
import { wsService } from "@/services/websocket";
import {
  EMPTY_EDITOR_STATE, prosemirrorToPlainText, stripTrailingEmptyParagraphs,
} from "@/utils/contentConverter";
import { smoothScrollToElement } from "@/utils/smoothScroll";
import { parseAttachments } from "@/components/ThreadAttachments";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { WallCommentComposer } from "@/components/wall/WallCommentComposer";
import type { GomoRichEditorHandle } from "@/components/GomoRichEditor";
import type { AttachmentMeta } from "@/types/forum";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";

const MAX_POST_DEPTH = 6;

interface ThreadPost {
  id: string;
  thread_id: string;
  user_id: string;
  content: string;
  content_json?: unknown;
  image_url?: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  reply_to?: string | null;
  is_private?: boolean;
  private_recipient_id?: string | null;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  profiles?: {
    id?: string;
    username?: string;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    avatar_url?: string | null;
    is_anonymous?: boolean;
  } | null;
}

interface LikeData {
  count: number;
  isLiked: boolean;
}

const legacyImageUrls = (post: ThreadPost): string[] =>
  Array.isArray(post.image_urls) && post.image_urls.length > 0
    ? post.image_urls
    : post.image_url
      ? [post.image_url]
      : [];

const buildAttachments = (post: ThreadPost): AttachmentMeta[] => {
  const parsed = parseAttachments(post.attachments);
  if (parsed.length > 0) {
    const known = new Set(
      parsed.filter((att) => att.type === "image").map((att) => att.url),
    );
    const extra = legacyImageUrls(post)
      .filter((url) => !known.has(url))
      .map((url) => ({
        url,
        type: "image" as const,
        mime: "image/*",
        name: "image",
        size: 0,
      }));
    return [...parsed, ...extra];
  }
  return legacyImageUrls(post).map((url) => ({
    url,
    type: "image" as const,
    mime: "image/*",
    name: "image",
    size: 0,
  }));
};

const isBlank = (t: unknown): boolean => {
  if (t == null) return true;
  const s = String(t);
  return s.trim().length === 0 || /^\u200b+$/.test(s.trim());
};

// ─── Single post node ────────────────────────────────────────────────────────

interface ThreadPostNodeProps {
  post: ThreadPost;
  children: ThreadPost[];
  tree: Map<string | null, ThreadPost[]>;
  postsById: Map<string, ThreadPost>;
  depth: number;
  isLast: boolean;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  collapsedIds: Set<string>;
  activeReplyId: string | null;
  activeEditId: string | null;
  editorStates: Record<string, { json: unknown; text: string }>;
  isSubmitting: Record<string, boolean>;
  likes: Record<string, LikeData>;
  highlightedPostId: string | null;
  startReply: (postId: string) => void;
  cancelReply: () => void;
  startEdit: (post: ThreadPost) => void;
  cancelEdit: () => void;
  updateEditorState: (key: string, value: { json: unknown; text: string }) => void;
  submitReply: (parentId: string) => Promise<void>;
  submitEdit: (postId: string) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  toggleLike: (post: ThreadPost) => Promise<void>;
  toggleCollapse: (postId: string) => void;
  onImageClick: (items: LightboxItem[], index: number) => void;
}

const ThreadPostNode = ({
  post,
  children,
  tree,
  postsById,
  depth,
  isLast,
  currentUserId,
  currentUsername,
  currentUserColor,
  collapsedIds,
  activeReplyId,
  activeEditId,
  editorStates,
  isSubmitting,
  likes,
  highlightedPostId,
  startReply,
  cancelReply,
  startEdit,
  cancelEdit,
  updateEditorState,
  submitReply,
  submitEdit,
  deletePost,
  toggleLike,
  toggleCollapse,
  onImageClick,
}: ThreadPostNodeProps) => {
  const dateLocale = useDateLocale();
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const isHighlighted = highlightedPostId === post.id;
  const isEditing = activeEditId === post.id;
  const isReplying = activeReplyId === post.id;
  const isCollapsed = collapsedIds.has(post.id);
  const hasChildren = children.length > 0;
  const canReply = depth < MAX_POST_DEPTH;
  const canEdit = currentUserId === post.user_id;
  const canDelete = currentUserId === post.user_id;

  const editState = editorStates[`edit:${post.id}`] || {
    json: post.content_json ?? undefined,
    text: post.content || "",
  };
  const editSubmitting = isSubmitting[`edit:${post.id}`] || false;

  const branchOffset = depth === 0 ? "ml-9 sm:ml-10" : "ml-8";
  const threadAxis = depth === 0 ? "left-[18px] sm:left-5" : "left-4";
  const threadRail = depth === 1 ? "-left-[18px] sm:-left-5" : "-left-4";
  const threadRailWidth = depth === 1 ? "w-[18px] sm:w-5" : "w-4";
  const threadStemTop = depth === 0 ? "top-5 sm:top-[22px]" : "top-[18px]";

  const avatarUrl = storageUrl("post-images", post.profiles?.avatar_url);
  const authorLabel = post.profiles?.display_name || post.profiles?.username || "Аноним";
  const like = likes[post.id] || { count: 0, isLiked: false };

  // Reply-to line: answer to parent's author (if the parent is still in the list).
  const parentPost = post.reply_to ? postsById.get(post.reply_to) ?? null : null;
  const replyAuthorName =
    depth > 0 && parentPost
      ? parentPost.profiles?.display_name || parentPost.profiles?.username || "Аноним"
      : null;

  // Old private posts are hidden from everyone but the author/recipient.
  const isHiddenPrivate =
    post.is_private &&
    currentUserId !== post.user_id &&
    currentUserId !== post.private_recipient_id;

  const attachments = useMemo(() => buildAttachments(post), [post]);

  return (
    <div
      data-thread-post-node="true"
      data-comment-id={post.id}
      className={`relative ${isHighlighted ? "animate-in slide-in-from-bottom-3 fade-in duration-500 ease-out motion-reduce:animate-none" : ""}`}
    >
      {depth > 0 && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute ${threadRail} top-0 ${threadRailWidth} h-7 rounded-bl-xl border-b-2 border-l-2 border-border/55`}
        />
      )}
      {depth > 0 && !isLast && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute ${threadRail} top-7 bottom-0 z-0 border-l-2 border-border/55`}
        />
      )}

      <div
        data-thread-highlighted={isHighlighted ? "true" : undefined}
        className={`group relative z-10 rounded-2xl py-2.5 transition-[background-color,box-shadow,color] duration-500 motion-reduce:transition-none hover:bg-muted/20 ${isHighlighted ? "bg-primary/[0.03] ring-1 ring-primary/15" : ""}`}
      >
        <div className="relative flex items-start gap-3">
          {hasChildren && (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute ${threadAxis} ${threadStemTop} bottom-[-14px] z-0 origin-top border-l-2 border-border/55 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${isCollapsed ? "scale-y-0 opacity-0" : "scale-y-100 opacity-100"}`}
            />
          )}

          {post.is_deleted ? (
            <div className="relative z-10 mt-0.5 shrink-0">
              <Avatar className={`${depth === 0 ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8"} border border-border/70 bg-muted shadow-sm`}>
                <AvatarFallback className="bg-muted text-muted-foreground/70">
                  <Ghost className="h-4 w-4" aria-hidden="true" />
                </AvatarFallback>
              </Avatar>
            </div>
          ) : (
            <Link
              to={`/profile/${post.user_id}`}
              className="relative z-10 mt-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar className={`${depth === 0 ? "h-9 w-9 sm:h-10 sm:w-10" : "h-8 w-8"} border border-border/70 bg-muted shadow-sm`}>
                <AvatarImage src={avatarUrl || undefined} alt={authorLabel} />
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {authorLabel.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
          )}

          <div className="min-w-0 flex-1">
            {post.is_deleted ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium italic text-muted-foreground">Автор неизвестен</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(safeDate(post.created_at), { locale: dateLocale, addSuffix: true })}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link
                  to={`/profile/${post.user_id}`}
                  className="text-sm font-semibold text-foreground hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {authorLabel}
                </Link>
                {post.profiles?.nickname_emoji_id && (
                  <NicknameEmoji emojiId={post.profiles.nickname_emoji_id} />
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(safeDate(post.created_at), { locale: dateLocale, addSuffix: true })}
                </span>
                {post.updated_at && post.updated_at !== post.created_at && (
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
                  placeholder="Измените пост"
                  onSubmit={() => submitEdit(post.id)}
                  onCancel={cancelEdit}
                  isSubmitting={editSubmitting}
                  json={editState.json}
                  text={editState.text}
                  onChange={(v) => updateEditorState(`edit:${post.id}`, v)}
                  resetKey={post.id.length}
                  compact
                />
              </div>
            ) : post.is_deleted ? (
              <div className="mt-1.5 text-sm italic leading-6 text-muted-foreground/70">Пост удалён</div>
            ) : (
              <div className="mt-1.5 max-w-[68ch] break-words text-sm leading-6 text-foreground/95">
                {isHiddenPrivate ? (
                  <span className="italic text-muted-foreground">Приватный ответ</span>
                ) : (
                  <ProcessedContent
                    content={post.content || ""}
                    contentJson={post.content_json}
                    currentUserId={currentUserId}
                    isAdmin={false}
                    currentUsername={currentUsername}
                    currentUserColor={currentUserColor}
                    postAuthorId={post.user_id}
                    authorUsername={post.profiles?.username}
                  />
                )}
              </div>
            )}

            {!isEditing && attachments.length > 0 && !isHiddenPrivate && (
              <div className="mt-2">
                <WallAttachments
                  attachments={attachments}
                  galleryKey={`thread-post-${post.id}`}
                  onImageClick={onImageClick}
                />
              </div>
            )}

            {!isEditing && (
              <div className="mt-2 flex flex-wrap items-center gap-1 opacity-90 transition-opacity sm:opacity-70 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {!post.is_deleted && currentUserId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-7 gap-1 px-1.5 text-xs ${like.isLiked ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => toggleLike(post)}
                  >
                    {isSubmitting[`like:${post.id}`] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Heart className={`h-3.5 w-3.5 ${like.isLiked ? "fill-current" : ""}`} />
                    )}
                    <span>{like.count > 0 ? like.count : ""}</span>
                  </Button>
                )}

                {!post.is_deleted && canReply && currentUserId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-7 gap-1 px-1.5 text-xs ${isReplying ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => (isReplying ? cancelReply() : startReply(post.id))}
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
                    className="h-7 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => toggleCollapse(post.id)}
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "rotate-180" : ""}`} />
                    {children.length}
                  </Button>
                )}

                {!post.is_deleted && (canEdit || canDelete) && (
                  <>
                    <div className="hidden items-center gap-1 sm:flex">
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => (isEditing ? cancelEdit() : startEdit(post))}
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
                          onClick={() => deletePost(post.id)}
                          disabled={isSubmitting[`delete:${post.id}`]}
                          title="Удалить"
                        >
                          {isSubmitting[`delete:${post.id}`] ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-xl text-muted-foreground sm:hidden"
                        aria-label="Действия с постом"
                        onClick={() => setMobileActionsOpen(true)}
                      >
                        <Ellipsis className="h-4 w-4" />
                      </Button>
                      <Sheet open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
                        <SheetContent side="bottom" className="rounded-t-3xl px-4 pb-8 pt-6 sm:hidden">
                          <SheetHeader className="mb-4 text-left">
                            <SheetTitle>Действия с постом</SheetTitle>
                          </SheetHeader>
                          <div className="grid gap-2">
                            {canEdit && (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-11 justify-start rounded-xl"
                                onClick={() => {
                                  setMobileActionsOpen(false);
                                  if (isEditing) cancelEdit();
                                  else startEdit(post);
                                }}
                              >
                                <Edit3 className="mr-2 h-4 w-4" />Редактировать
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-11 justify-start rounded-xl text-destructive hover:text-destructive"
                                onClick={() => {
                                  setMobileActionsOpen(false);
                                  void deletePost(post.id);
                                }}
                              >
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

      {hasChildren && !isCollapsed && (
        <div className={`relative ${branchOffset}`}>
          {children.map((child, index) => (
            <ThreadPostNode
              key={child.id}
              post={child}
              children={tree.get(child.id) || []}
              tree={tree}
              postsById={postsById}
              depth={depth + 1}
              isLast={index === children.length - 1}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
              collapsedIds={collapsedIds}
              activeReplyId={activeReplyId}
              activeEditId={activeEditId}
              editorStates={editorStates}
              isSubmitting={isSubmitting}
              likes={likes}
              highlightedPostId={highlightedPostId}
              startReply={startReply}
              cancelReply={cancelReply}
              startEdit={startEdit}
              cancelEdit={cancelEdit}
              updateEditorState={updateEditorState}
              submitReply={submitReply}
              submitEdit={submitEdit}
              deletePost={deletePost}
              toggleLike={toggleLike}
              toggleCollapse={toggleCollapse}
              onImageClick={onImageClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Tree root ───────────────────────────────────────────────────────────────

interface ThreadCommentTreeProps {
  threadId: string;
  currentUserId: string | null;
  /** Called with the signed delta after a post is added/removed. */
  onPostCountChange?: (delta: number) => void;
}

export const ThreadCommentTree = ({
  threadId,
  currentUserId,
  onPostCountChange,
}: ThreadCommentTreeProps) => {
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [editorStates, setEditorStates] = useState<Record<string, { json: unknown; text: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState<Record<string, boolean>>({});
  const [topLevelJson, setTopLevelJson] = useState<unknown>(EMPTY_EDITOR_STATE);
  const [topLevelText, setTopLevelText] = useState("");
  const [topLevelResetKey, setTopLevelResetKey] = useState(0);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [likes, setLikes] = useState<Record<string, LikeData>>({});
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [currentUsername, setCurrentUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const composerEditorRef = useRef<GomoRichEditorHandle>(null);

  // Current user's display meta (for mention coloring in ProcessedContent).
  useEffect(() => {
    if (!currentUserId) return;
    getCurrentUserMeta(currentUserId).then((meta) => {
      setCurrentUsername(meta.username);
      setCurrentUserColor(meta.color);
    }).catch(() => {});
  }, [currentUserId]);

  // Mobile keyboard state — same pattern as the wall comment tree.
  const { isTouch, isOpen: keyboardOpen } = useMobileKeyboard();
  const isTouchRef = useRef(isTouch);
  isTouchRef.current = isTouch;
  const keyboardOpenRef = useRef(keyboardOpen);
  keyboardOpenRef.current = keyboardOpen;
  const prevKeyboardOpenRef = useRef(keyboardOpen);
  const [composerFocused, setComposerFocused] = useState(false);

  const applyPin = useCallback(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor || !isTouchRef.current) return;
    const rect = anchor.getBoundingClientRect();
    anchor.classList.add("wall-composer-pinned");
    anchor.setAttribute("data-kb-locked", "true");
    anchor.style.left = `${rect.left}px`;
    anchor.style.width = `${rect.width}px`;
  }, []);

  const clearPin = useCallback(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor) return;
    anchor.classList.remove("wall-composer-pinned");
    anchor.removeAttribute("data-kb-locked");
    anchor.style.left = "";
    anchor.style.width = "";
  }, []);

  useEffect(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor) return;

    const onFocusIn = (e: FocusEvent) => {
      if (!anchor.contains(e.target as Node)) return;
      if (!isEditableElement(e.target as HTMLElement | null)) return;
      setComposerFocused(true);
      applyPin();
    };
    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related && anchor.contains(related)) return;
      if (!keyboardOpenRef.current) {
        setComposerFocused(false);
        clearPin();
      }
    };
    const onDocFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !isEditableElement(target) || anchor.contains(target)) return;
      setComposerFocused(false);
      clearPin();
    };

    anchor.addEventListener("focusin", onFocusIn);
    anchor.addEventListener("focusout", onFocusOut);
    document.addEventListener("focusin", onDocFocusIn);

    if (isTouchRef.current && anchor.contains(document.activeElement) && isEditableElement(document.activeElement)) {
      setComposerFocused(true);
      applyPin();
    }

    return () => {
      anchor.removeEventListener("focusin", onFocusIn);
      anchor.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("focusin", onDocFocusIn);
      clearPin();
    };
  }, [applyPin, clearPin]);

  useEffect(() => {
    const wasOpen = prevKeyboardOpenRef.current;
    prevKeyboardOpenRef.current = keyboardOpen;
    if (!wasOpen || keyboardOpen) return;
    const anchor = composerAnchorRef.current;
    if (anchor && anchor.contains(document.activeElement)) return;
    setComposerFocused(false);
    clearPin();
  }, [keyboardOpen, clearPin]);

  useEffect(() => {
    if (!composerFocused || !isTouch) return;
    const realign = () => {
      const anchor = composerAnchorRef.current;
      const root = rootRef.current;
      if (!anchor || !root || !anchor.classList.contains("wall-composer-pinned")) return;
      const rect = root.getBoundingClientRect();
      anchor.style.left = `${rect.left}px`;
      anchor.style.width = `${rect.width}px`;
    };
    window.addEventListener("resize", realign);
    window.addEventListener("orientationchange", realign);
    window.visualViewport?.addEventListener("resize", realign);
    return () => {
      window.removeEventListener("resize", realign);
      window.removeEventListener("orientationchange", realign);
      window.visualViewport?.removeEventListener("resize", realign);
    };
  }, [composerFocused, isTouch]);

  // ── Data loading ──────────────────────────────────────────────────────────
  // The posts REST endpoint does NOT resolve `profiles:user_id(*)` — it
  // returns profiles:null. Fetch the authors in one batch (same pattern as
  // the board feed) and merge them into the posts.
  const loadProfiles = useCallback(async (userIds: string[]): Promise<Map<string, ThreadPost["profiles"]>> => {
    const unique = [...new Set(userIds.filter(Boolean))];
    const map = new Map<string, ThreadPost["profiles"]>();
    if (unique.length === 0) return map;
    try {
      const res = await fetch(`/api/v1/profiles?id=in.(${unique.join(",")})`);
      const result = await res.json();
      for (const p of (result.data || []) as Array<{ id: string } & ThreadPost["profiles"]>) {
        map.set(p.id, p);
      }
    } catch (err) {
      console.warn("Failed to load post profiles:", (err as Error).message);
    }
    return map;
  }, []);

  const loadPosts = useCallback(async (): Promise<ThreadPost[]> => {
    try {
      const { data, error } = await api
        .from("posts")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      let list = (data || []) as ThreadPost[];
      // Attach authors (profiles are not embedded in the posts response).
      const profiles = await loadProfiles(list.map((p) => p.user_id));
      list = list.map((p) => ({ ...p, profiles: profiles.get(p.user_id) ?? null }));
      setPosts(list);
      setLoading(false);
      return list;
    } catch (err) {
      console.error("Error loading posts:", err);
      toast.error("Не удалось загрузить посты");
      setLoading(false);
      return [];
    }
  }, [threadId, loadProfiles]);

  // Batch like counts (single RPC, mirrors LikesCacheContext).
  const loadLikes = useCallback(async (postIds: string[]) => {
    if (postIds.length === 0) return;
    try {
      const { data } = await api.rpc("get_post_likes_batch", {
        post_ids: postIds.join(","),
        user_uuid: currentUserId || "",
      }) as { data?: Array<{ post_id?: string; count?: number; is_liked?: boolean }> };
      const next: Record<string, LikeData> = {};
      for (const item of data || []) {
        if (!item.post_id) continue;
        next[item.post_id] = { count: item.count ?? 0, isLiked: !!item.is_liked };
      }
      setLikes((prev) => ({ ...prev, ...next }));
    } catch (err) {
      console.warn("Failed to load like data batch:", (err as Error).message);
    }
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadPosts();
      if (!cancelled) {
        await loadLikes(list.map((p) => p.id));
      }
    })();
    return () => { cancelled = true; };
  }, [loadPosts, loadLikes]);

  // Realtime: new posts from other users.
  useEffect(() => {
    if (!threadId) return;
    wsService.subscribeToThread(threadId);
    const unsub = wsService.on("new_post", async (message) => {
      const data = message.data as { thread_id?: string; user_id?: string; id?: string } | undefined;
      if (!data || data.thread_id !== threadId) return;
      if (currentUserId && data.user_id === currentUserId) return; // own = optimistic reload
      try {
        const { data: rawPost } = await api
          .from("posts")
          .select("*")
          .eq("id", data.id)
          .maybeSingle();
        if (!rawPost) return;
        const profiles = await loadProfiles([(rawPost as ThreadPost).user_id]);
        const postData = { ...(rawPost as ThreadPost), profiles: profiles.get((rawPost as ThreadPost).user_id) ?? null };
        setPosts((prev) => {
          if (prev.some((p) => p.id === postData.id)) return prev;
          return [...prev, postData];
        });
        setLikes((prev) => ({ ...prev, [postData.id]: { count: 0, isLiked: false } }));
        onPostCountChange?.(1);
      } catch (err) {
        console.error("[WS] Failed to fetch new post:", err);
      }
    });
    return () => {
      unsub();
      wsService.unsubscribe(threadId);
    };
  }, [threadId, currentUserId, onPostCountChange, loadProfiles]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const startReply = useCallback((postId: string) => {
    let nextId: string | null = null;
    flushSync(() => {
      setActiveReplyId((prev) => {
        nextId = prev === postId ? null : postId;
        return nextId;
      });
    });
    if (nextId) {
      composerEditorRef.current?.focus();
    }
  }, []);

  const cancelReply = useCallback(() => setActiveReplyId(null), []);
  const startEdit = useCallback((post: ThreadPost) => {
    setActiveEditId(post.id);
    setEditorStates((prev) => ({
      ...prev,
      [`edit:${post.id}`]: {
        json: post.content_json ?? undefined,
        text: post.content || "",
      },
    }));
  }, []);
  const cancelEdit = useCallback(() => setActiveEditId(null), []);
  const updateEditorState = useCallback((key: string, value: { json: unknown; text: string }) => {
    setEditorStates((prev) => ({ ...prev, [key]: value }));
  }, []);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await api.auth.getSession();
    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }, []);

  const submitPost = useCallback(async (replyTo: string | null) => {
    if (!currentUserId) return;
    const key = replyTo ? `reply:${replyTo}` : "top-level";
    if (isSubmitting[key]) return;
    const state = editorStates["top-level"] || { json: topLevelJson, text: topLevelText };
    const rawText = String(state?.text ?? "");
    if (isBlank(rawText)) {
      toast.error("Напишите ответ");
      return;
    }
    const normalizedText = prosemirrorToPlainText(state?.json, "") || rawText;
    if (isBlank(normalizedText)) {
      toast.error("Напишите ответ");
      return;
    }
    setIsSubmitting((prev) => ({ ...prev, [key]: true }));
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/rpc/create_post", {
        method: "POST",
        headers,
        body: JSON.stringify({
          thread_id: threadId,
          content: normalizedText,
          content_json: stripTrailingEmptyParagraphs(state?.json),
          image_urls: null,
          attachments: null,
          reply_to: replyTo,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Не удалось отправить ответ");
      }
      const list = await loadPosts();
      await loadLikes(list.map((p) => p.id));
      onPostCountChange?.(1);
      setActiveReplyId(null);
      setTopLevelText("");
      setTopLevelJson(EMPTY_EDITOR_STATE);
      setTopLevelResetKey((prev) => prev + 1);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next["top-level"];
        return next;
      });
      invalidateByPrefix("/api/v1/posts");
      invalidateByPrefix("/api/v1/threads");
      // Glide to the newest post (the last one in chronological order).
      const lastId = list[list.length - 1]?.id;
      if (lastId) {
        setPendingScrollId(lastId);
        setHighlightedPostId(lastId);
      }
      toast.success("Ответ опубликован");
    } catch (error) {
      console.error("Error creating post:", error);
      toast.error("Не удалось отправить ответ");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [key]: false }));
    }
  }, [currentUserId, threadId, isSubmitting, editorStates, topLevelJson, topLevelText, loadPosts, loadLikes, authHeaders, onPostCountChange]);

  const submitEdit = useCallback(async (postId: string) => {
    if (!currentUserId) return;
    const stateKey = `edit:${postId}`;
    const state = editorStates[stateKey];
    if (!state || isBlank(state.text)) {
      toast.error("Напишите ответ");
      return;
    }
    setIsSubmitting((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/posts?id=eq.${postId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: state.text, content_json: stripTrailingEmptyParagraphs(state.json) }),
      });
      if (!res.ok) throw new Error("Не удалось обновить пост");
      await loadPosts();
      setActiveEditId(null);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next[stateKey];
        return next;
      });
      invalidateByPrefix("/api/v1/posts");
      toast.success("Пост обновлён");
    } catch (error) {
      console.error("Error updating post:", error);
      toast.error("Не удалось обновить пост");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, editorStates, loadPosts, authHeaders]);

  const deletePost = useCallback(async (postId: string) => {
    if (!currentUserId) return;
    const stateKey = `delete:${postId}`;
    setIsSubmitting((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/posts?id=eq.${postId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("Не удалось удалить пост");
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      onPostCountChange?.(-1);
      if (activeEditId === postId) setActiveEditId(null);
      if (activeReplyId === postId) setActiveReplyId(null);
      invalidateByPrefix("/api/v1/posts");
      invalidateByPrefix("/api/v1/threads");
      toast.success("Пост удалён");
    } catch (error) {
      console.error("Error deleting post:", error);
      toast.error("Не удалось удалить пост");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, authHeaders, activeEditId, activeReplyId, onPostCountChange]);

  const toggleLike = useCallback(async (post: ThreadPost) => {
    if (!currentUserId || isSubmitting[`like:${post.id}`]) return;
    setIsSubmitting((prev) => ({ ...prev, [`like:${post.id}`]: true }));
    const prev = likes[post.id] || { count: 0, isLiked: false };
    try {
      if (prev.isLiked) {
        setLikes((l) => ({ ...l, [post.id]: { count: Math.max(0, prev.count - 1), isLiked: false } }));
        const { error } = await api.from("post_likes").delete().eq("post_id", post.id).eq("user_id", currentUserId);
        if (error) throw error;
      } else {
        setLikes((l) => ({ ...l, [post.id]: { count: prev.count + 1, isLiked: true } }));
        const { error } = await api.from("post_likes").insert({ post_id: post.id, user_id: currentUserId });
        if (error) throw error;
      }
    } catch {
      setLikes((l) => ({ ...l, [post.id]: prev }));
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [`like:${post.id}`]: false }));
    }
  }, [currentUserId, likes, isSubmitting]);

  const toggleCollapse = useCallback((postId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  // Scroll to a freshly added post once it exists in the DOM.
  useEffect(() => {
    if (!pendingScrollId) return;
    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      const el = rootRef.current?.querySelector(`[data-comment-id="${pendingScrollId}"]`);
      if (el) {
        window.clearInterval(interval);
        smoothScrollToElement(el, { block: "center", duration: 700 });
        setPendingScrollId(null);
      } else if (attempts > 40) {
        window.clearInterval(interval);
        setPendingScrollId(null);
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [pendingScrollId, posts]);

  useEffect(() => {
    if (!highlightedPostId) return;
    const timer = window.setTimeout(() => setHighlightedPostId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [highlightedPostId]);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, ThreadPost[]>();
    for (const p of posts) {
      const key = p.reply_to || null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(p);
    }
    return byParent;
  }, [posts]);

  const postsById = useMemo(() => {
    const m = new Map<string, ThreadPost>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

  const replyTarget = activeReplyId ? postsById.get(activeReplyId) ?? null : null;
  const replyTargetName = replyTarget
    ? replyTarget.profiles?.display_name || replyTarget.profiles?.username || "Аноним"
    : null;

  useEffect(() => {
    if (activeReplyId && !replyTarget) setActiveReplyId(null);
  }, [activeReplyId, replyTarget]);

  const rootComments = tree.get(null) || [];
  const topLevelState = editorStates["top-level"] || { json: topLevelJson, text: topLevelText };

  return (
    <div ref={rootRef} className="border-t border-border/60 pt-4">
      {loading ? (
        <div className="space-y-3 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="h-7 w-7 animate-pulse rounded-full bg-muted sm:h-8 sm:w-8" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : rootComments.length === 0 ? (
        <div className="py-3 text-center text-sm text-muted-foreground">
          Тут пока пусто, но это можно исправить.
        </div>
      ) : (
        <div className={`space-y-0 ${isTouch && composerFocused ? "wall-comments-pad" : ""}`}>
          {rootComments.map((post, index) => (
            <ThreadPostNode
              key={post.id}
              post={post}
              children={tree.get(post.id) || []}
              tree={tree}
              postsById={postsById}
              depth={0}
              isLast={index === rootComments.length - 1}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
              collapsedIds={collapsedIds}
              activeReplyId={activeReplyId}
              activeEditId={activeEditId}
              editorStates={editorStates}
              isSubmitting={isSubmitting}
              likes={likes}
              highlightedPostId={highlightedPostId}
              startReply={startReply}
              cancelReply={cancelReply}
              startEdit={startEdit}
              cancelEdit={cancelEdit}
              updateEditorState={updateEditorState}
              submitReply={submitPost}
              submitEdit={submitEdit}
              deletePost={deletePost}
              toggleLike={toggleLike}
              toggleCollapse={toggleCollapse}
              onImageClick={(items, idx) => {
                setGalleryItems(items);
                setGalleryIndex(idx);
              }}
            />
          ))}
        </div>
      )}

      {currentUserId && (
        <div ref={composerAnchorRef} className={`sticky kb-bottom-8 z-20 ${isTouch && composerFocused ? "wall-comments-pad" : ""}`}>
          <WallCommentComposer
            focusToExpand
            autoFocus
            editorRef={composerEditorRef}
            placeholder="Напишите ответ"
            replyTo={replyTarget && replyTargetName ? { id: replyTarget.id, name: replyTargetName } : null}
            onSubmit={activeReplyId ? () => submitPost(activeReplyId) : () => submitPost(null)}
            onCancel={activeReplyId ? cancelReply : undefined}
            isSubmitting={
              isSubmitting["top-level"] ||
              (activeReplyId ? isSubmitting[`reply:${activeReplyId}`] || false : false)
            }
            json={topLevelState.json}
            text={topLevelState.text}
            resetKey={topLevelResetKey}
            onChange={({ json, text }) => {
              setTopLevelJson(json);
              setTopLevelText(text);
              setEditorStates((prev) => ({ ...prev, "top-level": { json, text } }));
            }}
          />
        </div>
      )}

      {/* Attachment lightbox */}
      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </div>
  );
};
