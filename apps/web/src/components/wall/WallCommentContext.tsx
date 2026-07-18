import { createContext, useContext } from "react";
import type { WallComment } from "@/utils/wallNormalizers";

export const MAX_COMMENT_DEPTH = 6;

const THREAD_COLORS = [
  "hsl(142, 70%, 35%)",
  "hsl(217, 70%, 55%)",
  "hsl(280, 60%, 50%)",
  "hsl(30, 80%, 50%)",
  "hsl(350, 65%, 50%)",
  "hsl(180, 55%, 40%)",
  "hsl(60, 50%, 45%)",
];

export const getThreadColor = (depth: number): string =>
  THREAD_COLORS[depth % THREAD_COLORS.length];

interface EditorState {
  json: unknown;
  text: string;
}

export interface WallCommentTreeContextValue {
  currentUserId: string | null;
  postUserId: string;
  currentUsername: string;
  postId: string;
  collapsedIds: Set<string>;
  activeReplyId: string | null;
  activeEditId: string | null;
  editorStates: Record<string, EditorState>;
  isSubmitting: Record<string, boolean>;
  commentsLoading: boolean;
  tree: Map<string | null, WallComment[]>;
  startReply: (commentId: string) => void;
  cancelReply: () => void;
  startEdit: (comment: WallComment) => void;
  cancelEdit: () => void;
  updateEditorState: (key: string, value: EditorState) => void;
  submitReply: (parentId: string) => Promise<void>;
  submitEdit: (commentId: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  toggleCollapse: (commentId: string) => void;
  onCommentCountChange: (delta: number) => void;
}

export const WallCommentTreeContext = createContext<WallCommentTreeContextValue | null>(null);

export const useCommentTree = (): WallCommentTreeContextValue => {
  const ctx = useContext(WallCommentTreeContext);
  if (!ctx) throw new Error("useCommentTree must be used within WallCommentTree");
  return ctx;
};
