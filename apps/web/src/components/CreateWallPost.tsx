import { useEffect, useMemo, useRef, useState } from "react";
import { ProfileAttachmentUpload } from "@/components/ProfileAttachmentUpload";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AttachmentMeta } from "@/types/forum";
import { api } from "@/integrations/api/compat";
import { ImageIcon, Loader2, Send, Smile } from "lucide-react";
import { toast } from "sonner";
import { EMPTY_EDITOR_STATE } from "@/utils/lexicalContent";
import type { WallPost } from "@/utils/wallNormalizers";

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

  const handleEmojiSelect = (emojiCode: string) => {
    editorRef.current?.focus();
    editorRef.current?.insertText(emojiCode);
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
        const { data, error } = await (api as any)
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
        const { data, error } = await (api as any)
          .from("profile_wall_posts")
          .insert([postData])
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
    <Card className="overflow-hidden border-border/70 bg-card shadow-sm">
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

              <ProfileAttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:text-xs">
              <span>{content.length} симв.</span>
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
