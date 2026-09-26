// Inline-media wall composer (P1). Behind the `wallInlineMedia` flag, rendered
// next to the legacy CreateWallPost. The heavy lifting — media blocks inside
// the document, slash commands, link cards, spoilers, YouTube, drag & drop and
// the in-place image editor — now lives in the shared RichComposer, which the
// g-sub and topic composers reuse. This file only owns the wall-specific
// persistence: profile_wall_posts inserts/updates and the wall draft format.

import { useCallback, useMemo } from "react";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";

import { RichComposer, type RichComposerPayload } from "@/components/composer/RichComposer";
import { EMPTY_EDITOR_STATE, normalizeContent } from "@/utils/contentConverter";
import { normalizeAttachments, type WallPost } from "@/utils/wallNormalizers";
import {
  appendAttachmentsAsMedia,
  type MediaAttachment,
} from "@/components/editor/media/mediaSchema";

const MAX_WALL_POST_LENGTH = 4000;
const DRAFT_PREFIX = "gomo6:wall-draft-v2:";

const POST_SELECT = `
  id, user_id, author_id, title, content, content_json, image_url, attachments,
  created_at, updated_at, is_pinned, pinned_order,
  author:profiles!author_id (username, is_anonymous, avatar_url)
`;

interface CreateWallPostInlineProps {
  profileUserId: string;
  currentUserId: string;
  editingPost?: WallPost;
  onPostCreated?: (post: WallPost) => void;
  onPostUpdated?: (post: WallPost) => void;
  onCancel: () => void;
  onBeforeCreate?: () => string;
}

/** A legacy post's attachments become mediaBlocks appended at the end. */
const buildInitialDocument = (editingPost?: WallPost): unknown => {
  const base = normalizeContent(editingPost?.content_json, editingPost?.content ?? "") ?? EMPTY_EDITOR_STATE;
  if (!editingPost) return base;
  return appendAttachmentsAsMedia(base, normalizeAttachments(editingPost));
};

const deriveTitle = (content: string): string => {
  const plain = content.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "Пост на стене";
  return plain.length > 80 ? `${plain.slice(0, 77).trimEnd()}...` : plain;
};

export const CreateWallPostInline = ({
  profileUserId,
  currentUserId,
  editingPost,
  onPostCreated,
  onPostUpdated,
  onCancel,
  onBeforeCreate,
}: CreateWallPostInlineProps) => {
  const isEditing = !!editingPost;
  const draftKey = `${DRAFT_PREFIX}${profileUserId}`;

  const initialContentJson = useMemo(() => buildInitialDocument(editingPost), [editingPost]);
  const initialAttachments = useMemo<MediaAttachment[]>(
    () => (editingPost ? normalizeAttachments(editingPost) : []),
    [editingPost],
  );

  const handlePublish = useCallback(
    async ({ json, text, attachments, cover }: RichComposerPayload) => {
      onBeforeCreate?.();
      try {
        const firstImage = attachments.find((att) => att.type === "image");
        const coverAttachment = cover
          ? attachments.find((att) => att.id === cover.id && att.type === "image")
          : null;
        const postData = {
          user_id: profileUserId,
          author_id: currentUserId,
          title: deriveTitle(text),
          content: text || null,
          content_json: json,
          image_url: coverAttachment?.url ?? firstImage?.url ?? null,
          attachments: attachments.length > 0 ? attachments : null,
        };

        if (isEditing) {
          const { data, error } = await api
            .from("profile_wall_posts")
            .update(postData as Record<string, unknown>)
            .eq("id", editingPost.id)
            .eq("author_id", currentUserId)
            .select(POST_SELECT)
            .single();
          if (error) throw error;
          onPostUpdated?.(data as WallPost);
          toast.success("Пост обновлён");
        } else {
          const { data, error } = await api
            .from("profile_wall_posts")
            .insert(postData as Record<string, unknown>)
            .select(POST_SELECT)
            .single();
          if (error) throw error;
          onPostCreated?.(data as WallPost);
          toast.success("Пост опубликован");
        }
      } catch (error) {
        console.error("Error saving wall post:", error);
        toast.error(isEditing ? "Ошибка обновления поста" : "Ошибка публикации поста");
      }
    },
    [currentUserId, editingPost, isEditing, onBeforeCreate, onPostCreated, onPostUpdated, profileUserId],
  );

  return (
    <RichComposer
      testId="wall-post-composer-inline"
      bucket="wall"
      headerLabel={isEditing ? "Редактирование записи" : "Новая запись на стене"}
      draftKey={isEditing ? undefined : draftKey}
      // Remount when switching which post is edited (same mounted instance).
      key={editingPost?.id ?? "new"}
      maxLength={MAX_WALL_POST_LENGTH}
      initialContentJson={initialContentJson}
      initialLegacyContent={editingPost?.content ?? ""}
      initialAttachments={initialAttachments}
      publishLabel={isEditing ? "Сохранить" : "Опубликовать"}
      resetOnPublish={!isEditing}
      onPublish={handlePublish}
      onClose={onCancel}
    />
  );
};
