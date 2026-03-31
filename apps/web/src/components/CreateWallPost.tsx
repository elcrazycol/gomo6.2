import { useMemo, useRef, useState } from "react";
import { AttachmentUpload } from "@/components/AttachmentUpload";
import { EmojiPicker } from "@/components/EmojiPicker";
import { InlineFormattingToolbar } from "@/components/InlineFormattingToolbar";
import { ProcessedContent } from "@/components/ProcessedContent";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AttachmentMeta } from "@/types/forum";
import { supabase } from "@/integrations/supabase/client";
import { ImageIcon, Loader2, Send, Smile, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

export interface WallPost {
  id: string;
  user_id: string;
  author_id: string;
  title: string;
  content: string | null;
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
  const editorRef = useRef<RichTextEditorHandle>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const [content, setContent] = useState(editingPost?.content || "");
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
    <Card className="overflow-hidden border-border/70 bg-gradient-to-br from-card via-card to-muted/30 shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-border/60 bg-gradient-to-r from-primary/8 via-transparent to-primary/5 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                {isEditing ? "Редактирование записи" : "Новая запись на стене"}
              </div>
              <p className="text-xs text-muted-foreground">
                BB-теги, эмодзи и вложения работают прямо здесь.
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="rounded-3xl border border-border/70 bg-background/85 p-3 shadow-inner sm:p-4">
            <RichTextEditor
              ref={editorRef}
              value={content}
              onChange={setContent}
              onSubmit={handleSubmit}
              placeholder="Что у вас нового? Напишите красиво, добавьте теги, спойлеры и эмодзи."
              className="min-h-[140px] border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-1">
              <InlineFormattingToolbar editorRef={editorRef} />
            </div>

            <EmojiPicker onEmojiSelect={handleEmojiSelect} triggerRef={emojiButtonRef}>
              <Button
                ref={emojiButtonRef}
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-2xl border-border/70"
                title="Добавить эмодзи"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </EmojiPicker>

            <AttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />

            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
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
              <div className="space-y-3 rounded-3xl border border-dashed border-border/70 bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Предпросмотр
                </div>
                <div className="rounded-3xl border border-border/70 bg-background p-4">
                  {content.trim() ? (
                    <ProcessedContent content={content} />
                  ) : (
                    <span className="text-sm text-muted-foreground">Текст появится здесь</span>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Enter отправляет пост на десктопе, Shift+Enter переносит строку.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>
                Отмена
              </Button>
              <Button type="button" disabled={isSubmitting || !canSubmit} onClick={handleSubmit} className="rounded-2xl px-5">
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
