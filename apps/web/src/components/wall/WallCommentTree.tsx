import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { WallCommentTreeContext } from "./WallCommentContext";
import { WallCommentNode } from "./WallCommentNode";
import { WallCommentComposer } from "./WallCommentComposer";
import { EMPTY_EDITOR_STATE } from "@/utils/contentConverter";
import { prosemirrorToPlainText } from "@/utils/contentConverter";
import type { WallComment } from "@/utils/wallNormalizers";
import { normalizeWallComment } from "@/utils/wallNormalizers";

interface WallCommentTreeProps {
  postId: string;
  postUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  onCommentCountChange: (delta: number) => void;
  forceOpen?: boolean;
}

export const WallCommentTree = ({
  postId,
  postUserId,
  currentUserId,
  currentUsername,
  onCommentCountChange,
  forceOpen = false,
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

  const loadComments = useCallback(async () => {
    try {
      setLoading(true);
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
    } catch (err) {
      console.error("Error loading wall comments:", err);
      toast.error("Не удалось загрузить комментарии");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

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
    setActiveReplyId((prev) => (prev === commentId ? null : commentId));
  }, []);

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
      const { error } = await api
        .from("profile_wall_post_comments")
        .insert({
          post_id: postId,
          user_id: currentUserId,
          content: normalizedText,
          content_json: normalizedJson.json,
        });
      if (error) throw error;
      await loadComments();
      onCommentCountChange(1);
      setTopLevelText("");
      setTopLevelJson(EMPTY_EDITOR_STATE);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next["top-level"];
        return next;
      });
    } catch (error) {
      console.error("Error creating wall comment:", error);
      toast.error("Не удалось отправить комментарий");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, "top-level": false }));
    }
  }, [currentUserId, postId, loadComments, onCommentCountChange, editorStates, topLevelJson, topLevelText, isSubmitting]);

  const submitReply = useCallback(async (parentId: string) => {
    if (!currentUserId) return;
    const stateKey = `reply:${parentId}`;
    const state = editorStates[stateKey];
    if (!state || isBlank(state.text)) {
      toast.error("Напишите ответ");
      return;
    }
    setIsSubmitting((prev) => ({ ...prev, [stateKey]: true }));
    try {
      const { error } = await api
        .from("profile_wall_post_comments")
        .insert({
          post_id: postId,
          user_id: currentUserId,
          parent_id: parentId,
          content: state.text,
          content_json: state.json,
        });
      if (error) throw error;
      await loadComments();
      onCommentCountChange(1);
      setActiveReplyId(null);
      setEditorStates((prev) => {
        const next = { ...prev };
        delete next[stateKey];
        return next;
      });
    } catch (error) {
      console.error("Error creating reply:", error);
      toast.error("Не удалось отправить ответ");
    } finally {
      setIsSubmitting((prev) => ({ ...prev, [stateKey]: false }));
    }
  }, [currentUserId, postId, loadComments, onCommentCountChange, editorStates]);

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
        .update({ content: state.text, content_json: state.json })
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
    loading, tree,
    startReply, cancelReply, startEdit, cancelEdit, updateEditorState,
    submitReply, submitEdit, deleteComment, toggleCollapse, onCommentCountChange,
  ]);

  const rootComments = tree.get(null) || [];

  return (
    <WallCommentTreeContext.Provider value={contextValue}>
      <div className="space-y-3 border-t border-border/60 pt-4">
        {currentUserId && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 p-3">
            <WallCommentComposer
              placeholder="Напишите комментарий"
              onSubmit={submitTopLevel}
              isSubmitting={isSubmitting["top-level"] || false}
              json={topLevelState.json}
              text={topLevelState.text}
              onChange={({ json, text }) => {
                setTopLevelJson(json);
                setTopLevelText(text);
                setEditorStates((prev) => ({ ...prev, "top-level": { json, text } }));
              }}
            />
          </div>
        )}

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
          <>
            <div className="text-xs text-muted-foreground">
              {comments.length} {comments.length === 1 ? "комментарий" : comments.length < 5 ? "комментария" : "комментариев"}
            </div>
            <div className="space-y-0">
              {rootComments.map((comment) => {
                const children = tree.get(comment.id) || [];
                return (
                  <WallCommentNode
                    key={comment.id}
                    comment={comment}
                    children={children}
                    tree={tree}
                    depth={0}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </WallCommentTreeContext.Provider>
  );
};
