import { useMemo, useRef, useState } from "react";
import { AttachmentUpload } from "@/components/AttachmentUpload";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { ProcessedContent } from "@/components/ProcessedContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AttachmentMeta } from "@/types/forum";
import { supabase } from "@/integrations/supabase/client";
import { ImageIcon, Loader2, Send, Smile, Sparkles } from "lucide-react";
import { toast } from "sonner";

export interface WallPost {
  id: string;
  user_id: string;
  author_id: string;
  title: string;
  content: string | null;
  content_json?: unknown;
  image_url: string | null;
  attachments?: AttachmentMeta[] | null;
  created_at: string;
  updated_at: string;
  is_pinned?: boolean;
  pinned_order?: number | null;
  author: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  };
}

interface CreateWallPostProps {
  profileUserId: string;
  currentUserId: string;
  editingPost?: WallPost;
  onPostCreated?: (post: WallPost) => void;
  onPostUpdated?: (post: WallPost) => void;
  onCancel: () => void;
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
}: CreateWallPostProps) => {
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const [content, setContent] = useState(editingPost?.content || "");
  const [contentJson, setContentJson] = useState<unknown>(editingPost?.content_json || null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(() => normalizeAttachments(editingPost));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!editingPost;
  const canSubmit = content.trim().length > 0 || attachments.length > 0;

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
        const { data, error } = await (supabase as any)
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
        const { data, error } = await (supabase as any)
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
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                {isEditing ? "Редактирование записи" : "Новая запись на стене"}
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Форматирование видно сразу, без BB-тегов.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 p-3 sm:space-y-4 sm:p-5">
          <div className="border border-border/70 bg-background p-2.5 sm:p-4">
            <GomoRichEditor
              ref={editorRef}
              contentJson={editingPost?.content_json}
              legacyContent={editingPost?.content}
              onChange={({ json, text }) => {
                setContentJson(json);
                setContent(text);
              }}
              onSubmit={handleSubmit}
              placeholder="Что у вас нового? Напишите красиво, добавьте теги, спойлеры и эмодзи."
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

              <AttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />
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

          {(content.trim() || attachments.length > 0) && (
            <>
              <Separator />
              <div className="space-y-2 border border-dashed border-border/70 bg-muted/20 p-3 sm:space-y-3 sm:p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Предпросмотр
                </div>
                <div className="border border-border/70 bg-background p-3 sm:p-4">
                  {content.trim() ? (
                    <ProcessedContent content={content} contentJson={contentJson} currentUserId={null} isAdmin={false} currentUsername="" />
                  ) : (
                    <span className="text-sm text-muted-foreground">Текст появится здесь</span>
                  )}
                </div>
              </div>
            </>
          )}

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
