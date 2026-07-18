import { createContext, useContext } from "react";
import type { WallComment } from "@/utils/wallNormalizers";

export const MAX_COMMENT_DEPTH = 6;

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
