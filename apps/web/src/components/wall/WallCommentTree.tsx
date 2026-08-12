import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { isEditableElement } from "@/lib/mobileKeyboard";
import type { GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { WallCommentTreeContext } from "./WallCommentContext";
import { WallCommentNode } from "./WallCommentNode";
import { WallCommentComposer } from "./WallCommentComposer";
import { EMPTY_EDITOR_STATE, prosemirrorToPlainText, stripTrailingEmptyParagraphs } from "@/utils/contentConverter";
import { smoothScrollToElement } from "@/utils/smoothScroll";
import type { WallComment } from "@/utils/wallNormalizers";
import { normalizeWallComment } from "@/utils/wallNormalizers";

interface WallCommentTreeProps {
  postId: string;
  postUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  onCommentCountChange: (delta: number) => void;
  /** Fired once after the first successful load — lets the parent unfold the
      section only when real content is ready (no skeleton flash on first open). */
  onFirstLoad?: () => void;
}

export const WallCommentTree = ({
  postId,
  postUserId,
  currentUserId,
  currentUsername,
  onCommentCountChange,
  onFirstLoad,
}: WallCommentTreeProps) => {
  const [comments, setComments] = useState<WallComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [editorStates, setEditorStates] = useState<Record<string, { json: unknown; text: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState<Record<string, boolean>>({});
  const [topLevelJson, setTopLevelJson] = useState<unknown>(EMPTY_EDITOR_STATE);
  const [topLevelText, setTopLevelText] = useState("");
  const [topLevelResetKey, setTopLevelResetKey] = useState(0);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const composerEditorRef = useRef<GomoRichEditorHandle>(null);
  const touchEndTimerRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const firstLoadFiredRef = useRef(false);

  // While the composer is focused the on-screen keyboard is (about to be) up.
  // position:sticky would let the composer scroll away with the comment list;
  // position:fixed pins it above the keyboard no matter how the page scrolls.
  // Only the focused composer gets pinned — focus tracking is per-tree, so
  // other posts' composers on the same wall stay in flow.
  const { isTouch, isOpen: keyboardOpen } = useMobileKeyboard();
  const [composerActive, setComposerActive] = useState(false);
  // keyboardOpen differs by platform: on iOS it is true while the keyboard is
  // up (and stays true through the ~280ms dismissal slide); on Android with
  // resizes-content the layout shrinks so the delta is ~0 and it stays false
  // even while typing. The focusout handler needs the live value, hence the ref.
  const keyboardOpenRef = useRef(keyboardOpen);
  keyboardOpenRef.current = keyboardOpen;
  const isTouchRef = useRef(isTouch);
  isTouchRef.current = isTouch;
  // Track open→closed transitions. The [keyboardOpen] effect must NOT clear
  // the pin on its mount run: autoFocus pins synchronously in the listeners
  // effect, and at that moment keyboardOpen is still false (the keyboard opens
  // a beat later via the visual-viewport resize). Clearing on mount would
  // immediately undo the pin — the "1 in 10 opens off the top" bug. Only a
  // real open→closed transition (keyboard fully dismissed) releases the pin.
  const prevOpenRef = useRef(keyboardOpen);

  // The pin must be applied SYNCHRONOUSLY in the focus event: React state
  // renders a frame later, and in that window iOS performs its focus-scroll
  // (and the autoFocus case fires before this component's listeners exist),
  // dragging the still-sticky composer off the top edge — the "1 in 10 opens
  // above the screen" bug. Adding the fixed class + width + data-kb-locked
  // directly on the DOM node in the focus handler closes that race. React's
  // static className never rewrites these (the value doesn't change), so the
  // manual classes are the single source of truth.
  // A tap-and-immediately-drag on the composer (user presses to open it and
  // keeps dragging) starts the gesture before focus ever lands, so the
  // focusin-based pin is too late — the still-sticky bar rides off the top
  // edge. Pinning on touchstart (synchronously, in the same touch dispatch)
  // closes that window: the composer is fixed + locked the instant the finger
  // touches it, before the first touchmove can scroll anything.
  const applyPin = useCallback(() => {
    const anchor = composerAnchorRef.current;
    const root = rootRef.current;
    if (!anchor || !root || !isTouchRef.current) return;
    anchor.classList.add("wall-composer-fixed");
    anchor.setAttribute("data-kb-locked", "true");
    anchor.style.width = `${root.clientWidth}px`;
  }, []);

  const clearPin = useCallback(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor) return;
    anchor.classList.remove("wall-composer-fixed");
    anchor.removeAttribute("data-kb-locked");
    anchor.style.width = "";
  }, []);

  useEffect(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor) return;
    const onFocusIn = (e: FocusEvent) => {
      if (!anchor.contains(e.target as Node)) return;
      // Focus landed — the touchend timer (if any) must not clear the pin in
      // case focus arrived slower than its 120ms window (slow keyboard open).
      if (touchEndTimerRef.current) {
        clearTimeout(touchEndTimerRef.current);
        touchEndTimerRef.current = null;
      }
      setComposerActive(true);
      applyPin();
    };
    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget;
      // Hand-off to another editable (an inline comment editor) → release the
      // pin; that editor owns the keyboard now.
      if (related instanceof HTMLElement && !anchor.contains(related) && isEditableElement(related)) {
        setComposerActive(false);
        clearPin();
        return;
      }
      // Focus moving INSIDE the composer (toolbar buttons, cancel…) keeps it
      // pinned. Leaving the composer unpins immediately when the keyboard is
      // already gone or never tracked (Android tap-outside → keyboard hides
      // right away). On iOS a scroll-to-dismiss blur keeps it pinned while the
      // keyboard slides away; the keyboardOpen effect below releases it once
      // the keyboard is fully gone.
      if (!keyboardOpenRef.current) {
        setComposerActive(false);
        clearPin();
      }
    };
    // Pin the moment the finger touches the composer (see applyPin comment).
    const onTouchStart = () => {
      if (!isTouchRef.current) return;
      setComposerActive(true);
      applyPin();
    };
    // A pure scroll gesture that began on the composer never delivers focus
    // (the drag is also cancelled by the [data-kb-locked] handler, so nothing
    // moved). Release the optimistic touchstart pin after a beat so the bar
    // returns to the document flow — unless focus actually landed (real tap).
    const onTouchEnd = () => {
      if (!isTouchRef.current) return;
      if (touchEndTimerRef.current) clearTimeout(touchEndTimerRef.current);
      touchEndTimerRef.current = window.setTimeout(() => {
        touchEndTimerRef.current = null;
        const still = composerAnchorRef.current;
        if (still && !still.contains(document.activeElement)) {
          setComposerActive(false);
          clearPin();
        }
      }, 120);
    };
    anchor.addEventListener("focusin", onFocusIn);
    anchor.addEventListener("focusout", onFocusOut);
    anchor.addEventListener("touchstart", onTouchStart, { passive: true });
    anchor.addEventListener("touchend", onTouchEnd, { passive: true });
    anchor.addEventListener("touchcancel", onTouchEnd, { passive: true });
    // autoFocus fires during commit, before this effect's listeners attach —
    // re-check the live focus and pin right away so the composer never starts
    // out sticky (which iOS focus-scrolls off-screen).
    if (isTouchRef.current && anchor.contains(document.activeElement)) {
      setComposerActive(true);
      applyPin();
    }
    return () => {
      if (touchEndTimerRef.current) {
        clearTimeout(touchEndTimerRef.current);
        touchEndTimerRef.current = null;
      }
      anchor.removeEventListener("focusin", onFocusIn);
      anchor.removeEventListener("focusout", onFocusOut);
      anchor.removeEventListener("touchstart", onTouchStart);
      anchor.removeEventListener("touchend", onTouchEnd);
      anchor.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applyPin, clearPin]);

  // Release the pin only on a real open→closed transition (keyboard fully
  // dismissed — after the dismissal slide, or the user dismissed it via the
  // keyboard itself) so the composer returns to the document flow at the end
  // of the comment list. The mount run (false→false) never clears: see the
  // prevOpenRef comment above.
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = keyboardOpen;
    if (wasOpen && !keyboardOpen) {
      setComposerActive(false);
      clearPin();
    }
  }, [keyboardOpen, clearPin]);

  const pinned = composerActive && isTouch;
  const padActive = pinned;

  // A position:fixed element cannot inherit its container's width, so while the
  // composer is pinned we measure the comment tree's content width and mirror
  // it (re-measuring on rotation / window resize). This keeps the pinned
  // composer pixel-aligned with the post column in every layout (profile
  // column, standalone post page, embedded cards). Only re-measures while the
  // pin is actually applied (pinned); the pin itself is added/removed
  // synchronously in the focus handlers.
  useEffect(() => {
    const anchor = composerAnchorRef.current;
    const root = rootRef.current;
    if (!anchor || !root) return;
    if (!pinned) return;
    const applyWidth = () => {
      anchor.style.width = `${root.clientWidth}px`;
    };
    applyWidth();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(applyWidth);
      observer.observe(root);
    }
    window.addEventListener("resize", applyWidth);
    window.addEventListener("orientationchange", applyWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", applyWidth);
      window.removeEventListener("orientationchange", applyWidth);
    };
  }, [pinned]);
  // Keep onFirstLoad in a ref so loadComments stays identity-stable — if the
  // parent passed an inline function, the [loadComments] effect below would
  // refetch (and flash the skeleton) on every parent re-render.
  const onFirstLoadRef = useRef(onFirstLoad);
  onFirstLoadRef.current = onFirstLoad;

  const loadComments = useCallback(async () => {
    try {
      // Keep the current list visible during refresh — flashing the skeleton
      // after every submit made the freshly added comment blink in and out.
      if (!hasLoadedRef.current) setLoading(true);
      const { data, error } = await api
        .from("profile_wall_post_comments")
        .select(`
          id,
          post_id,
          user_id,
          parent_id,
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
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setComments(((data || []) as Record<string, unknown>[]).map(normalizeWallComment));
      hasLoadedRef.current = true;
    } catch (err) {
      console.error("Error loading wall comments:", err);
      toast.error("Не удалось загрузить комментарии");
    } finally {
      setLoading(false);
      // Tell the parent the first fetch settled (success or failure) so it can
      // unfold the section with real content instead of a skeleton flash.
      if (!firstLoadFiredRef.current) {
        firstLoadFiredRef.current = true;
        onFirstLoadRef.current?.();
      }
    }
  }, [postId]);

  useEffect(() => {
    // Fresh post → treat the next fetch as the initial one (with skeleton).
    hasLoadedRef.current = false;
    loadComments();
  }, [loadComments]);

  // After a successful submit, glide to the fresh comment. The list reloads
  // asynchronously, so poll until the node exists, then start the eased scroll.
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
  }, [pendingScrollId, comments]);

  // The soft highlight fades away on its own after a moment.
  useEffect(() => {
    if (!highlightedCommentId) return;
    const timer = window.setTimeout(() => setHighlightedCommentId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [highlightedCommentId]);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, WallComment[]>();
    for (const c of comments) {
      const key = c.parent_id || null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    }
    return byParent;
  }, [comments]);

  const startReply = useCallback((commentId: string) => {
    // Pin BEFORE anything mounts. GomoRichEditor's autoFocus effect focuses
    // the editor DURING the flushSync commit below — if the composer were
    // still sticky at that instant, iOS's native focus-scroll would scroll
    // the page down to the composer's natural position (the end of the
    // comment list) and everything would fly up. position:fixed from the very
    // first frame makes that focus-scroll a no-op, while the keyboard still
    // opens because the focus happens inside the tap's call stack.
    const isTouch = isTouchRef.current;
    if (isTouch) {
      setComposerActive(true);
      applyPin();
    }
    // iOS only opens the keyboard for a focus() call that runs synchronously
    // inside the tap's call stack. React state updates are deferred, so flush
    // the reply-target change NOW (mounting the editor box — showBox forces it
    // open for replyTo) and focus immediately, all within the tap handler.
    let nextId: string | null = null;
    flushSync(() => {
      setActiveReplyId((prev) => {
        nextId = prev === commentId ? null : commentId;
        return nextId;
      });
    });
    if (nextId) {
      // Only focus when actually starting a reply — a toggle-off (cancel) must
      // not pop the keyboard back open. The pin above is already in place;
      // focusin re-applies it idempotently.
      composerEditorRef.current?.focus();
    } else if (isTouch && !keyboardOpenRef.current) {
      // Toggle-off (cancel): undo the optimistic pin so the bar returns to
      // the document flow. When the keyboard is still open, leave the pin in
      // place — the keyboardOpen effect releases it once the keyboard fully
      // closes (unpinning mid-open would drop the bar behind the keyboard).
      setComposerActive(false);
      clearPin();
    }
  }, [applyPin, clearPin]);

  // The reply target the floating composer answers (or null → plain comment).
  const replyTarget = activeReplyId ? comments.find((c) => c.id === activeReplyId) ?? null : null;
  const replyTargetName = replyTarget ? (replyTarget.author.display_name || replyTarget.author.username) : null;

  // If the targeted comment disappears (deleted elsewhere), drop reply mode.
  useEffect(() => {
    if (activeReplyId && !replyTarget) setActiveReplyId(null);
  }, [activeReplyId, replyTarget]);

  const cancelReply = useCallback(() => {
    setActiveReplyId(null);
  }, []);

  const startEdit = useCallback((comment: WallComment) => {
    setActiveEditId(comment.id);
    setEditorStates((prev) => ({
      ...prev,
      [`edit:${comment.id}`]: {
        json: comment.content_json ?? undefined,
        text: comment.content || "",
      },
    }));
  }, []);

  const cancelEdit = useCallback(() => {
    setActiveEditId(null);
  }, []);

  const updateEditorState = useCallback((key: string, value: { json: unknown; text: string }) => {
    setEditorStates((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isBlank = (t: unknown) => {
    if (t == null) return true;
    const s = String(t);
    return s.trim().length === 0 || /^\u200b+$/.test(s.trim());
  };

  const submitTopLevel = useCallback(async () => {
    if (!currentUserId || isSubmitting["top-level"]) return;
    const normalizedJson = editorStates["top-level"] || { json: topLevelJson, text: topLevelText };
    const rawText = String(normalizedJson.text ?? topLevelText ?? "");
    if (isBlank(rawText)) {
      toast.error("Напишите комментарий");
      return;
    }
    const normalizedText = prosemirrorToPlainText(normalizedJson.json, "") || rawText;
    if (isBlank(normalizedText)) {
      toast.error("Напишите комментарий");
      return;
    }
    setIsSubmitting((prev) => ({ ...prev, "top-level": true }));
    try {
      const { data, error } = await api
        .from("profile_wall_post_comments")
        .insert({
          post_id: postId,
          user_id: currentUserId,
          content: normalizedText,
          content_json: stripTrailingEmptyParagraphs(normalizedJson.json),
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      const newCommentId = (data as { id?: string } | null)?.id ?? null;
      await loadComments();
      onCommentCountChange(1);
      setTopLevelText("");
      setTopLevelJson(EMPTY_EDITOR_STATE);
      setTopLevelResetKey((prev) => prev + 1);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next["top-level"];
        return next;
      });
      if (newCommentId) {
        setPendingScrollId(newCommentId);
        setHighlightedCommentId(newCommentId);
        toast.success("Комментарий опубликован");
      }
    } catch (error) {
      console.error("Error creating wall comment:", error);
      toast.error("Не удалось отправить комментарий");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, "top-level": false }));
    }
  }, [currentUserId, postId, loadComments, onCommentCountChange, editorStates, topLevelJson, topLevelText, isSubmitting]);

  const submitReply = useCallback(async (parentId: string) => {
    if (!currentUserId || isSubmitting[`reply:${parentId}`]) return;
    const stateKey = `reply:${parentId}`;
    // The reply shares the floating composer's draft with top-level comments.
    const state = editorStates["top-level"] || { json: topLevelJson, text: topLevelText };
    const rawText = String(state?.text ?? "");
    if (isBlank(rawText)) {
      toast.error("Напишите ответ");
      return;
    }
    // Same normalization as top-level comments so both land in the DB identically.
    const normalizedText = prosemirrorToPlainText(state?.json, "") || rawText;
    if (isBlank(normalizedText)) {
      toast.error("Напишите ответ");
      return;
    }
    setIsSubmitting((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const { data, error } = await api
        .from("profile_wall_post_comments")
        .insert({
          post_id: postId,
          user_id: currentUserId,
          parent_id: parentId,
          content: normalizedText,
          content_json: stripTrailingEmptyParagraphs(state?.json),
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      const newCommentId = (data as { id?: string } | null)?.id ?? null;
      await loadComments();
      onCommentCountChange(1);
      setActiveReplyId(null);
      // The branch the reply landed in must be visible so the scroll target exists.
      setCollapsedIds((prev) => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      setTopLevelText("");
      setTopLevelJson(EMPTY_EDITOR_STATE);
      setTopLevelResetKey((prev) => prev + 1);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next["top-level"];
        return next;
      });
      if (newCommentId) {
        setPendingScrollId(newCommentId);
        setHighlightedCommentId(newCommentId);
        toast.success("Ответ опубликован");
      }
    } catch (error) {
      console.error("Error creating reply:", error);
      toast.error("Не удалось отправить ответ");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, postId, loadComments, onCommentCountChange, editorStates, topLevelJson, topLevelText, isSubmitting]);

  const submitEdit = useCallback(async (commentId: string) => {
    if (!currentUserId) return;
    const stateKey = `edit:${commentId}`;
    const state = editorStates[stateKey];
    if (!state || isBlank(state.text)) {
      toast.error("Напишите комментарий");
      return;
    }
    setIsSubmitting((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const { error } = await api
        .from("profile_wall_post_comments")
        .update({ content: state.text, content_json: stripTrailingEmptyParagraphs(state.json) })
        .eq("id", commentId)
        .eq("user_id", currentUserId);
      if (error) throw error;
      await loadComments();
      setActiveEditId(null);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next[stateKey];
        return next;
      });
      toast.success("Комментарий обновлён");
    } catch (error) {
      console.error("Error updating comment:", error);
      toast.error("Не удалось обновить комментарий");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, loadComments, editorStates]);

  const deleteComment = useCallback(async (commentId: string) => {
    if (!currentUserId) return;
    const stateKey = `delete:${commentId}`;
    setIsSubmitting((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const { error } = await api
        .from("profile_wall_post_comments")
        .delete()
        .eq("id", commentId);
      if (error) throw error;
      await loadComments();
      onCommentCountChange(-1);
      if (activeEditId === commentId) setActiveEditId(null);
      if (activeReplyId === commentId) setActiveReplyId(null);
      toast.success("Комментарий удалён");
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Не удалось удалить комментарий");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, loadComments, onCommentCountChange, activeEditId, activeReplyId]);

  const toggleCollapse = useCallback((commentId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  }, []);

  const topLevelState = editorStates["top-level"] || { json: topLevelJson, text: topLevelText };

  const contextValue = useMemo(() => ({
    currentUserId,
    postUserId,
    currentUsername,
    postId,
    collapsedIds,
    activeReplyId,
    activeEditId,
    editorStates,
    isSubmitting,
    commentsLoading: loading,
    tree,
    highlightedCommentId,
    startReply,
    cancelReply,
    startEdit,
    cancelEdit,
    updateEditorState,
    submitReply,
    submitEdit,
    deleteComment,
    toggleCollapse,
    onCommentCountChange,
  }), [
    currentUserId, postUserId, currentUsername, postId,
    collapsedIds, activeReplyId, activeEditId, editorStates, isSubmitting,
    loading, tree, highlightedCommentId,
    startReply, cancelReply, startEdit, cancelEdit, updateEditorState,
    submitReply, submitEdit, deleteComment, toggleCollapse, onCommentCountChange,
  ]);

  const rootComments = tree.get(null) || [];

  return (
    <WallCommentTreeContext.Provider value={contextValue}>
      {/* wall-comments-pad reserves scroll room below the last comment while
          the composer is pinned: without it the final comment can never be
          scrolled above the keyboard (iOS keeps the layout viewport full
          height), so it would sit hidden behind the keyboard/composer. */}
      <div
        ref={rootRef}
        className={`space-y-3 border-t border-border/60 pt-4 ${padActive ? "wall-comments-pad" : ""}`}
      >
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
          <div className="py-3 text-center text-sm text-muted-foreground">Тут пока пусто, но это можно исправить.</div>
        ) : (
          <div className="space-y-0" data-wall-roots="true">
            {rootComments.map((comment, index) => {
              const children = tree.get(comment.id) || [];
              return (
                <WallCommentNode
                  key={comment.id}
                  comment={comment}
                  children={children}
                  tree={tree}
                  depth={0}
                  isLast={index === rootComments.length - 1}
                />
              );
            })}
          </div>
        )}

        {currentUserId && (
          // Floating, backgroundless composer: lifted off the bottom edge so
          // the panel reads as a clean input, not a docked bar. kb-bottom-8
          // adds the keyboard inset to the offset, so on iOS the bar floats
          // above the keyboard instead of under it (the layout viewport never
          // shrinks there). While the composer is focused the bar switches to
          // position:fixed — sticky would let it scroll away with the comment
          // list, which is exactly the "composer rides off who-knows-where"
          // bug. The width is measured and applied inline (see above).
          <div
            ref={composerAnchorRef}
            className="sticky kb-bottom-8 z-20"
          >
            <WallCommentComposer
              focusToExpand
              autoFocus
              editorRef={composerEditorRef}
              placeholder="Напишите комментарий"
              replyTo={replyTarget && replyTargetName ? { id: replyTarget.id, name: replyTargetName } : null}
              onSubmit={activeReplyId ? () => submitReply(activeReplyId) : submitTopLevel}
              onCancel={activeReplyId ? cancelReply : undefined}
              isSubmitting={isSubmitting["top-level"] || (activeReplyId ? isSubmitting[`reply:${activeReplyId}`] || false : false)}
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
      </div>
    </WallCommentTreeContext.Provider>
  );
};
