import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProfileAttachmentUpload } from "@/components/ProfileAttachmentUpload";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AttachmentMeta } from "@/types/forum";
import { api } from "@/integrations/api/compat";
import { ImageIcon, ImagePlus, Loader2, Send, Smile } from "lucide-react";
import { toast } from "sonner";
import { EMPTY_EDITOR_STATE } from "@/utils/contentConverter";
import { uploadAttachments } from "@/utils/mediaUpload";
import { useFileDrop } from "@/hooks/useFileDrop";
import type { WallPost } from "@/utils/wallNormalizers";

// Same precedent as the messenger (4000 chars); the editor hard-stops input here.
const MAX_WALL_POST_LENGTH = 4000;
// Mirrors the ProfileAttachmentUpload maxFiles used on the wall.
const MAX_WALL_ATTACHMENTS = 8;

interface CreateWallPostProps {
  profileUserId: string;
  currentUserId: string;
  editingPost?: WallPost;
  onPostCreated?: (post: WallPost) => void;
  onPostUpdated?: (post: WallPost) => void;
  onCancel: () => void;
  onBeforeCreate?: () => string; // Returns temp ID for deduplication
}

const deriveTitle = (content: string) => {
  const plain = content
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return "Пост на стене";
  return plain.length > 80 ? `${plain.slice(0, 77).trimEnd()}...` : plain;
};

const normalizeAttachments = (post?: WallPost): AttachmentMeta[] => {
  if (!post) return [];
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

export const CreateWallPost = ({
  profileUserId,
  currentUserId,
  editingPost,
  onPostCreated,
  onPostUpdated,
  onCancel,
  onBeforeCreate,
}: CreateWallPostProps) => {
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const [content, setContent] = useState(editingPost?.content || "");
  const [contentJson, setContentJson] = useState<unknown>(editingPost?.content_json || null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(() => normalizeAttachments(editingPost));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);

  const isEditing = !!editingPost;
  const canSubmit = content.trim().length > 0 || attachments.length > 0;

  // Files dropped anywhere on the composer card attach via the same upload
  // path as the paperclip button.
  const handleDropFiles = useCallback(async (files: File[]) => {
    if (isSubmitting) return;
    const remaining = MAX_WALL_ATTACHMENTS - attachments.length;
    if (remaining <= 0) return;
    try {
      const uploaded = await uploadAttachments(files.slice(0, remaining), "wall");
      if (uploaded.length > 0) {
        setAttachments((prev) => [...prev, ...uploaded]);
      }
    } catch (error) {
      console.error("Wall post drop upload failed:", error);
      toast.error("Не удалось загрузить вложения");
    }
  }, [attachments, isSubmitting]);

  const { isDragging: isWallDragging, dragHandlers: wallDragHandlers } = useFileDrop(handleDropFiles);

  useEffect(() => {
    setContent(editingPost?.content || "");
    setContentJson(editingPost?.content_json || null);
    setAttachments(normalizeAttachments(editingPost));
    setEditorResetKey((prev) => prev + 1);
  }, [editingPost]);

  const imageCount = useMemo(
    () => attachments.filter((attachment) => attachment.type === "image").length,
    [attachments]
  );

  const handleEmojiSelect = (data: { emojiId: string; packId: string; url: string; name: string }) => {
    editorRef.current?.focus();
    editorRef.current?.insertEmoji(data);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Добавьте текст или вложение");
      return;
    }

    setIsSubmitting(true);

    // Generate temp ID for deduplication BEFORE API call
    onBeforeCreate?.();

    try {
      const contentValue = content.trim() || null;
      const imageAttachment = attachments.find((attachment) => attachment.type === "image");
      const postData = {
        user_id: profileUserId,
        author_id: currentUserId,
        title: deriveTitle(contentValue || ""),
        content: contentValue,
        content_json: contentJson,
        image_url: imageAttachment?.url || null,
        attachments: attachments.length > 0 ? attachments : null,
      };

      if (isEditing) {
        const { data, error } = await api
          .from("profile_wall_posts")
          .update(postData)
          .eq("id", editingPost.id)
          .eq("author_id", currentUserId)
          .select(`
            id,
            user_id,
            author_id,
            title,
            content,
            content_json,
            image_url,
            attachments,
            created_at,
            updated_at,
            is_pinned,
            pinned_order,
            author:profiles!author_id (
              username,
              is_anonymous,
              avatar_url
            )
          `)
          .single();

        if (error) throw error;

        onPostUpdated?.(data as WallPost);
        toast.success("Пост обновлен");
      } else {
        const { data, error } = await api
          .from("profile_wall_posts")
          .insert(postData as Record<string, unknown>)
          .select(`
            id,
            user_id,
            author_id,
            title,
            content,
            content_json,
            image_url,
            attachments,
            created_at,
            updated_at,
            is_pinned,
            pinned_order,
            author:profiles!author_id (
              username,
              is_anonymous,
              avatar_url
            )
          `)
          .single();

        if (error) throw error;

        onPostCreated?.(data as WallPost);
        setContent("");
        setContentJson(EMPTY_EDITOR_STATE);
        setAttachments([]);
        setEditorResetKey((prev) => prev + 1);
        toast.success("Пост опубликован");
      }
    } catch (error) {
      console.error("Error saving wall post:", error);
      toast.error(isEditing ? "Ошибка обновления поста" : "Ошибка публикации поста");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card data-testid="wall-post-composer" className="relative overflow-hidden border-border/70 bg-card shadow-sm" {...wallDragHandlers}>
      {/* Drag & drop attach hint covering the whole composer */}
      {isWallDragging && attachments.length < MAX_WALL_ATTACHMENTS && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-background/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary/25 bg-card px-8 py-6 shadow-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
              <ImagePlus className="h-6 w-6" />
            </div>
            <span className="text-sm font-semibold text-foreground">Отпустите, чтобы прикрепить</span>
            <span className="text-xs text-muted-foreground">Фото, видео и файлы появятся в записи</span>
          </div>
        </div>
      )}
      <CardContent className="p-0">
        <div className="border-b border-border/60 px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="text-sm font-semibold">
            {isEditing ? "Редактирование записи" : "Новая запись на стене"}
          </div>
        </div>

        <div className="space-y-3 p-3 sm:space-y-4 sm:p-5">
          <div className="border border-border/70 bg-background p-2.5 sm:p-4">
            <GomoRichEditor
              ref={editorRef}
              resetKey={editorResetKey}
              maxLength={MAX_WALL_POST_LENGTH}
              contentJson={contentJson}
              legacyContent={content}
              onChange={({ json, text }) => {
                setContentJson(json);
                setContent(text);
              }}
              onSubmit={handleSubmit}
              placeholder="Что у вас нового? Напишите красиво, добавьте теги, эмодзи и вложения."
              minHeightClassName="min-h-[120px] sm:min-h-[140px]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <EmojiPicker onEmojiSelect={handleEmojiSelect} triggerRef={emojiButtonRef}>
                <Button
                  ref={emojiButtonRef}
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 border-border/70 sm:h-10 sm:w-10"
                  title="Добавить эмодзи"
                >
                  <Smile className="h-4 w-4" />
                </Button>
              </EmojiPicker>

              <ProfileAttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} bucket="wall" dropZone={false} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:text-xs">
              <span
                className={content.replace(/\u200b/g, "").length >= MAX_WALL_POST_LENGTH
                  ? "font-medium text-destructive"
                  : content.replace(/\u200b/g, "").length >= MAX_WALL_POST_LENGTH * 0.95
                    ? "font-medium text-amber-500"
                    : ""}
              >
                {content.replace(/\u200b/g, "").length}/{MAX_WALL_POST_LENGTH} симв.
              </span>
              <span>•</span>
              <span>{attachments.length} влож.</span>
              {imageCount > 0 && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="h-3.5 w-3.5" />
                    {imageCount}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="hidden text-[11px] text-muted-foreground sm:block sm:text-xs">
              Enter отправляет пост на десктопе, Shift+Enter переносит строку.
            </p>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button type="button" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none">
                Отмена
              </Button>
              <Button type="button" disabled={isSubmitting || !canSubmit} onClick={handleSubmit} className="flex-1 px-4 sm:flex-none sm:px-5">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isEditing ? "Сохраняем" : "Публикуем"}
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    {isEditing ? "Сохранить" : "Опубликовать"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
