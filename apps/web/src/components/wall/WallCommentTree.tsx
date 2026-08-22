import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
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

  // Mobile keyboard state — used to detect touch devices: on touch the
  // composer docks as a fixed bar at the bottom of the screen (always visible
  // while the comments are open) and rides --kb-inset above the keyboard; on
  // desktop it stays sticky at the end of the comments. The docked bar needs
  // no pinning dance — it never leaves the bottom, so iOS never focus-scrolls
  // it and there is no fixed/flow switch to flicker.
  const { isTouch } = useMobileKeyboard();

  // On the wall-post OVERLAY the docked composer would live inside the
  // overlay's own scroll container. A direct tap on the already-expanded
  // editor (the user typed, blurred, then taps again) would then make iOS
  // focus-scroll that container — the page itself is locked, so the content
  // yanks and the app header hides for a moment. The messenger avoids this by
  // keeping its composer inside a fixed panel with no scrollable ancestor;
  // mirror that by portaling the dock OUT of the scroll container into the
  // overlay root. The composer is position:fixed, so the teleport is
  // visually invisible — and now iOS has nothing to focus-scroll.
  const [dockPortalRoot, setDockPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const anchor = composerAnchorRef.current;
    if (!anchor || !isTouch) {
      setDockPortalRoot(null);
      return;
    }
    setDockPortalRoot(anchor.closest('[data-testid="wall-post-page"]') as HTMLElement | null);
  }, [isTouch]);
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

  const dock = (
    <div
      ref={composerAnchorRef}
      className={isTouch ? "wall-composer-dock" : "sticky kb-bottom-8 z-20"}
    >
      <div className={isTouch ? "mx-auto w-full max-w-4xl px-3 pt-2 wall-composer-dock-pad" : undefined}>
        <WallCommentComposer
          minimal={isTouch}
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
    </div>
  );

  return (
    <WallCommentTreeContext.Provider value={contextValue}>
      {/* On touch the composer is a fixed bottom bar that is always on screen,
          so reserve scroll room below the last comment (wall-comments-pad-touch:
          bar height + --kb-inset for iOS, where the layout viewport never
          resizes) — otherwise the final comment would sit hidden behind it. */}
      <div
        ref={rootRef}
        className={`space-y-3 border-t border-border/60 pt-4 ${isTouch ? "wall-comments-pad-touch" : ""}`}
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
          // On touch the composer docks as a fixed bar at the bottom of the
          // screen — always visible while the comments are open, whether the
          // user is scrolled at the top or the end. It rides --kb-inset above
          // the keyboard (like the messenger chat panel), so there is nothing
          // to pin or re-align on focus. On desktop it stays sticky at the
          // end of the comments as before.
          //
          // On the wall-post overlay the dock is PORTALED out of the overlay's
          // scroll container (into the overlay root) so the editor has no
          // scrollable ancestor — otherwise iOS focus-scrolls that container
          // on a direct re-tap and the whole page jumps. Position:fixed makes
          // the move visually invisible.
          (isTouch && dockPortalRoot ? createPortal(dock, dockPortalRoot) : dock)
        )}
      </div>
    </WallCommentTreeContext.Provider>
  );
};
