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
  const hasLoadedRef = useRef(false);
  const firstLoadFiredRef = useRef(false);

  // Mobile keyboard state — used to detect if we're on touch device and
  // whether the software keyboard is actually up.
  const { isTouch, isOpen: keyboardOpen } = useMobileKeyboard();
  const isTouchRef = useRef(isTouch);
  isTouchRef.current = isTouch;
  const keyboardOpenRef = useRef(keyboardOpen);
  keyboardOpenRef.current = keyboardOpen;
  const prevKeyboardOpenRef = useRef(keyboardOpen);

  // Simple state: is the composer docked (focused or the keyboard is up)?
  const [composerFocused, setComposerFocused] = useState(false);

  // Pin the composer as position:fixed above the keyboard. MUST run
  // SYNCHRONOUSLY inside the focus event: React state renders a frame later,
  // and in that window iOS performs its focus-scroll on the still-sticky
  // composer, dragging it (and the page) up — the "composer flies up on
  // re-tap" bug. A fixed element is never focus-scrolled and never detaches
  // from the bottom, so the scroll-room pad below it stays invisible instead
  // of showing as a gaping empty area.
  const applyPin = useCallback(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor || !isTouchRef.current) return;
    // Measure the in-flow geometry BEFORE switching to fixed: a fixed element
    // measures against the viewport, so mirroring the same rect keeps the bar
    // pixel-aligned with the comment column in every layout.
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

  // Focus tracking for the composer. The bar is docked while its editor owns
  // the keyboard, and released only when the keyboard is really gone AND the
  // focus left — never on the blur that precedes a reply-button tap (which
  // would flash the docked bar out of place), and never mid-dismissal (the bar
  // must ride the keyboard down, not teleport back into the flow).
  useEffect(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor) return;

    const onFocusIn = (e: FocusEvent) => {
      if (!anchor.contains(e.target as Node)) return;
      // Only the EDITOR pins the bar. The collapsed one-line pill is a plain
      // <button>, and tapping it fires focus BEFORE click: pinning on that
      // focus yanks the anchor out of the flow (position:fixed + the scroll
      // pad appearing under the finger), so the click that should expand the
      // composer lands on a different element and the pill never opens on the
      // first tap. The editor (an editable) only mounts while the box is
      // expanding, so focusing it pins at exactly the right moment.
      if (!isEditableElement(e.target as HTMLElement | null)) return;
      setComposerFocused(true);
      applyPin();
    };

    const onFocusOut = (e: FocusEvent) => {
      // Focus moving INSIDE the composer (toolbar buttons, cancel…) keeps the
      // pin — the keyboard is still up and the bar must stay docked.
      const related = e.relatedTarget as HTMLElement | null;
      if (related && anchor.contains(related)) return;
      // Left the composer. If the keyboard is still up (e.g. focus went to a
      // reply button — startReply re-focuses the editor within the same tap),
      // stay docked; the keyboard-closed effect or a focus landing on another
      // editor will release the bar.
      if (!keyboardOpenRef.current) {
        setComposerFocused(false);
        clearPin();
      }
    };

    // Another editor anywhere took the keyboard (a comment's inline edit box,
    // the header search…) — hand over the dock immediately.
    const onDocFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !isEditableElement(target) || anchor.contains(target)) return;
      setComposerFocused(false);
      clearPin();
    };

    anchor.addEventListener("focusin", onFocusIn);
    anchor.addEventListener("focusout", onFocusOut);
    document.addEventListener("focusin", onDocFocusIn);

    // autoFocus fires during commit, before this effect's listeners attach —
    // re-check the live focus and pin right away so the composer never starts
    // out sticky (which iOS focus-scrolls off-screen). Only an editable
    // (the editor) pins — never the collapsed pill button.
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

  // Release the dock once the keyboard has fully closed and the focus has left
  // the composer. The keyboard-closed state lags the blur by the whole
  // dismissal animation — keeping the pin during that window makes the bar
  // ride the keyboard down (in sync with --kb-inset) instead of jumping back
  // into the comment flow mid-animation.
  useEffect(() => {
    const wasOpen = prevKeyboardOpenRef.current;
    prevKeyboardOpenRef.current = keyboardOpen;
    if (!wasOpen || keyboardOpen) return;
    const anchor = composerAnchorRef.current;
    // Keyboard dismissed while the editor kept focus (e.g. the keyboard's own
    // hide button): stay docked — tapping the editor again reopens the
    // keyboard without firing a new focusin, so the bar must not have moved.
    if (anchor && anchor.contains(document.activeElement)) return;
    setComposerFocused(false);
    clearPin();
  }, [keyboardOpen, clearPin]);

  // While pinned, keep the fixed bar aligned with the comment column when the
  // viewport changes (orientation change, iOS URL bar show/hide, rotation).
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
          is_deleted,
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
      // Focus the editor to open the keyboard.
      // The editor's focus method uses preventScroll:true to avoid
      // browser auto-scroll which causes the composer to jump.
      composerEditorRef.current?.focus();
    }
  }, []);

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
      // The comment is soft-deleted server-side: it stays in the list as a
      // "Комментарий удалён" placeholder (with the reply subtree intact), so
      // the visible comment count must NOT change.
      await loadComments();
      if (activeEditId === commentId) setActiveEditId(null);
      if (activeReplyId === commentId) setActiveReplyId(null);
      toast.success("Комментарий удалён");
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Не удалось удалить комментарий");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, loadComments, activeEditId, activeReplyId]);

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
          scrolled above the keyboard/composer (iOS keeps the layout viewport
          full height), so it would sit hidden behind them. */}
      <div
        ref={rootRef}
        className={`space-y-3 border-t border-border/60 pt-4 ${isTouch && composerFocused ? "wall-comments-pad" : ""}`}
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
          // Sticky composer at the end of the comments; on touch it is pinned
          // as position:fixed above the keyboard the moment its editor gets
          // focus (wall-composer-pinned, applied synchronously in the focus
          // handler) and released back into the flow on blur.
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
