import { lexicalJsonToPlainText } from "@/utils/lexicalContent";
import { prosemirrorToPlainText } from "@/utils/contentConverter";
import type { AttachmentMeta } from "@/types/forum";
import { safeDate } from "@/utils/safeDate";

export interface WallPost {
  id: string;
  user_id: string;
  author_id: string;
  title?: string | null;
  content?: string | null;
  content_json?: unknown;
  image_url?: string | null;
  attachments?: AttachmentMeta[] | null;
  repost_of_post_id?: string | null;
  created_at: string;
  updated_at: string;
  is_pinned?: boolean;
  pinned_order?: number | null;
  original_post?: WallPost | null;
  author: {
    username: string;
    display_name?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  };
  [key: string]: unknown;
}

export interface WallComment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id?: string | null;
  content: string | null;
  content_json?: unknown;
  created_at: string;
  updated_at: string;
  author: {
    username: string;
    display_name?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  };
}

export const normalizeWallPostAuthor = (author: unknown, fallbackUsername?: string) => {
  const authorSource = Array.isArray(author) ? author[0] : author;

  if (authorSource && typeof authorSource === 'object' && 'username' in (authorSource as Record<string, unknown>)) {
    const a = authorSource as { username: string; display_name?: string | null; is_anonymous?: boolean; avatar_url?: string | null };
    return {
      username: a.username,
      display_name: a.display_name || null,
      is_anonymous: Boolean(a.is_anonymous),
      avatar_url: a.avatar_url || null,
    };
  }

  return {
    username: fallbackUsername || "user",
    display_name: null,
    is_anonymous: false,
    avatar_url: null,
  };
};

export const normalizeWallPostRecord = (post: Record<string, unknown>, currentUsername?: string): WallPost => {
  const originalPostSource = (post?.original_post as Record<string, unknown> | null | undefined) ?? null;
  const postAuthor = post?.author as Record<string, unknown> | null | undefined;
  const postAuthorUsername = postAuthor?.username as string | undefined;

  return {
    ...post,
    repost_of_post_id: (post?.repost_of_post_id as string | null | undefined) ?? null,
    author: normalizeWallPostAuthor(postAuthor, postAuthorUsername || currentUsername),
    original_post: originalPostSource
      ? {
          ...originalPostSource,
          repost_of_post_id: (originalPostSource?.repost_of_post_id as string | null | undefined) ?? null,
          created_at: (originalPostSource?.created_at as string | null | undefined) || new Date().toISOString(),
          author: normalizeWallPostAuthor(
            originalPostSource?.author as Record<string, unknown> | null | undefined,
            ((originalPostSource?.author as Record<string, unknown> | undefined)?.username as string | undefined) || currentUsername,
          ),
        }
      : null,
  } as WallPost;
};

export const normalizeWallComment = (comment: Record<string, unknown>): WallComment => {
  const contentJson = comment?.content_json ?? null;
  const contentStr = comment?.content as string | undefined;

  const fromJson = prosemirrorToPlainText(contentJson, "") || lexicalJsonToPlainText(contentJson, "");
  const hasJsonContent = fromJson.trim().length > 0 && fromJson !== "\u200b";
  const content = hasJsonContent ? fromJson : (contentStr || "");

  return {
    id: comment.id as string,
    post_id: comment.post_id as string,
    user_id: comment.user_id as string,
    parent_id: (comment.parent_id as string | null) ?? null,
    content,
    content_json: contentJson,
    created_at: (comment.created_at as string | null | undefined) || new Date().toISOString(),
    updated_at: (comment.updated_at as string | null | undefined) || new Date().toISOString(),
    author: normalizeWallPostAuthor(comment?.author as Record<string, unknown> | null | undefined),
  };
};

export const getWallPostPath = (profileUserId: string, postId: string) =>
  `/profile/${profileUserId}/wall/${postId}`;

export const isInteractiveTarget = (target: EventTarget | null, currentTarget?: HTMLElement | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const interactiveElement = target.closest(
    "a, button, input, textarea, select, summary, [role='button'], [contenteditable='true'], [data-wall-no-open='true']"
  );

  if (!interactiveElement) return false;
  if (currentTarget && interactiveElement === currentTarget) return false;

  return true;
};

export const normalizeAttachments = (post: WallPost): AttachmentMeta[] => {
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
