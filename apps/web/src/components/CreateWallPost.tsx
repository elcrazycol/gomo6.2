import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { RichContentRenderer } from "@/components/RichContentRenderer";
import { PublishButton } from "@/components/PublishButton";
import { getPublishButtonStyle } from "@/lib/publishButtonStyle";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { uploadAttachments, type AttachmentMeta } from "@/utils/mediaUpload";
import { storageUrl } from "@/utils/storage";
import { useEmojiKeyboardSwap } from "@/hooks/useEmojiKeyboardSwap";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { useFileDrop } from "@/hooks/useFileDrop";
import { EMPTY_EDITOR_STATE } from "@/utils/contentConverter";
import type { WallPost } from "@/utils/wallNormalizers";
import { Eye, FileText, FileVideo2, Loader2, Music, Paperclip, PenLine, Smile, X } from "lucide-react";

// Same precedent as the messenger (4000 chars); the editor hard-stops input here.
const MAX_WALL_POST_LENGTH = 4000;
// Mirrors the old wall composer limit.
const MAX_WALL_ATTACHMENTS = 8;
const DRAFT_PREFIX = "gomo6:wall-draft:";

interface CreateWallPostProps {
  profileUserId: string;
  currentUserId: string;
  editingPost?: WallPost;
  onPostCreated?: (post: WallPost) => void;
  onPostUpdated?: (post: WallPost) => void;
  onCancel: () => void;
  onBeforeCreate?: () => string; // Returns temp ID for deduplication
}

interface WallDraft {
  content: string;
  contentJson: unknown;
  attachments: AttachmentMeta[];
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

// Wall attachments live in the private "wall" bucket — resolve a storage key to
// a display URL (full URLs from uploadAttachments pass through unchanged).
const wallSrc = (key?: string | null) => (key ? storageUrl("wall", key) || key : undefined);

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touch: the emoji trigger swaps the soft keyboard for the panel (same
  // height, same slide) and back — see useEmojiKeyboardSwap.
  const emojiSwap = useEmojiKeyboardSwap(editorRef);
  const { keyboardInset } = useMobileKeyboard();

  const [content, setContent] = useState(editingPost?.content || "");
  const [contentJson, setContentJson] = useState<unknown>(editingPost?.content_json || null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(() => normalizeAttachments(editingPost));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  // Publish button style — read once on mount (user picks it in Settings → Appearance).
  const [publishButtonStyle] = useState(getPublishButtonStyle);
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  // While closing, the panel plays its slide-down animation before onCancel is
  // fired (which unmounts the overlay).
  const [closing, setClosing] = useState(false);

  const isEditing = !!editingPost;
  const canSubmit = content.trim().length > 0 || attachments.length > 0;
  const draftKey = `${DRAFT_PREFIX}${profileUserId}`;

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    // Drop focus so the mobile keyboard starts retracting right away — the
    // slide-down plays while it descends behind the opaque panel.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.setTimeout(() => onCancel(), 280);
  }, [closing, onCancel]);

  useEffect(() => {
    setContent(editingPost?.content || "");
    setContentJson(editingPost?.content_json || null);
    setAttachments(normalizeAttachments(editingPost));
    setEditorResetKey((prev) => prev + 1);
  }, [editingPost]);

  // Lock page scroll while the overlay is up so the content underneath can't
  // move (restored on unmount — after the close animation finishes). The app's
  // html has overflow-x:hidden in CSS, which stops body overflow:hidden from
  // propagating to the viewport — so html must be locked too. iOS ignores
  // overflow:hidden on the body, so touchmoves that start OUTSIDE the composer
  // (and outside the portaled emoji panel) are prevented outright; touches
  // inside the panel keep scrolling its own areas.
  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    const root = composerRootRef.current;
    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (root?.contains(target)) return;
      if (target.closest('[data-testid="emoji-keyboard-panel"], [data-testid="emoji-picker-popover"]')) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
      document.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
    };
  }, []);

  // Restore an autosaved draft for this wall (create mode only).
  useEffect(() => {
    if (isEditing) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as WallDraft;
        if (draft?.content || draft?.attachments?.length) {
          setContent(draft.content || "");
          setContentJson(draft.contentJson ?? null);
          setAttachments(draft.attachments || []);
          setRestoredDraft(true);
        }
      }
    } catch {
      // Corrupt draft — ignore.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft (debounced) — create mode only, never for edits.
  useEffect(() => {
    if (isEditing) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const draft: WallDraft = { content, contentJson, attachments };
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        // Storage full — ignore, publishing still works.
      }
    }, 350);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [isEditing, draftKey, content, contentJson, attachments]);

  // Escape closes the composer — unless the emoji panel is up, where Escape
  // belongs to the panel (closes it, keyboard back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !emojiSwap.open) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, emojiSwap.open]);

  // Emoji panel ↔ keyboard: the composer is bottom-anchored at --kb-inset, so
  // while the keyboard is up the toolbar floats right above it. The moment the
  // swap panel opens the keyboard dismisses and --kb-inset drops to 0 — the
  // composer's bottom is lifted by the panel height so the toolbar never moves.
  useEffect(() => {
    const root = composerRootRef.current;
    if (!root) return;
    if (emojiSwap.open) {
      const lift = Math.max(emojiSwap.height, keyboardInset);
      root.style.setProperty("bottom", `${lift}px`);
    } else {
      root.style.removeProperty("bottom");
    }
  }, [emojiSwap.open, emojiSwap.height, keyboardInset]);

  const imageAttachments = useMemo(
    () => attachments.filter((att) => att.type === "image"),
    [attachments]
  );

  const handleEmojiSelect = (data: { emojiId: string; packId: string; url: string; name: string }) => {
    if (emojiSwap.open) {
      // Panel replaced the keyboard: insert at the saved caret WITHOUT
      // refocusing, so the keyboard stays hidden and the user can keep
      // adding emojis. ProseMirror preserves the selection across the blur.
      editorRef.current?.insertEmoji(data, { focus: false });
    } else {
      editorRef.current?.focus();
      editorRef.current?.insertEmoji(data);
    }
  };

  // Shared upload path for the paperclip button and drag & drop — goes to the
  // private, authorization-gated "wall" bucket.
  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await uploadAttachments(files, "wall");
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      console.error("Attachment upload error", err);
      toast.error("Не удалось загрузить файлы");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (attachments.length + files.length > MAX_WALL_ATTACHMENTS) {
      toast.error(`Максимум ${MAX_WALL_ATTACHMENTS} файлов`);
      return;
    }
    await uploadFiles(files);
  };

  // Files dropped anywhere on the composer panel attach via the same path.
  const handleDropFiles = useCallback((files: File[]) => {
    if (isSubmitting) return;
    const remaining = MAX_WALL_ATTACHMENTS - attachments.length;
    if (remaining <= 0) return;
    void uploadFiles(files.slice(0, remaining));
  }, [attachments, isSubmitting, uploadFiles]);

  const { isDragging: isWallDragging, dragHandlers: wallDragHandlers } = useFileDrop(handleDropFiles);

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const openAttachmentEditor = (imageAttachmentIndex: number) => {
    setGalleryIndex(imageAttachmentIndex);
    setShowGallery(true);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} КБ`;
    return `${(kb / 1024).toFixed(1)} МБ`;
  };

  const renderAttachmentsGrid = (readonly: boolean) => {
    if (attachments.length === 0) return null;
    return (
      <div className="grid grid-cols-3 gap-2 max-h-[22dvh] overflow-y-auto pr-0.5">
        {attachments.map((att, index) => {
          const removeBtn = (
            <button
              type="button"
              onClick={() => removeAttachment(index)}
              aria-label="Удалить вложение"
              className="absolute top-1 right-1 z-10 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center active:scale-90 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          );
          if (att.type === "image") {
            const imgIdx = imageAttachments.findIndex((img) => img.url === att.url);
            return (
              <div key={`${att.url}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-border/60 bg-muted/40">
                {readonly ? (
                  <img src={wallSrc(att.url)} alt={att.name || ""} className="w-full h-full object-cover" />
                ) : (
                  <button type="button" className="w-full h-full" onClick={() => openAttachmentEditor(imgIdx)}>
                    <img src={wallSrc(att.url)} alt={att.name || ""} className="w-full h-full object-cover" />
                  </button>
                )}
                {!readonly && removeBtn}
              </div>
            );
          }
          if (att.type === "video") {
            return (
              <div key={`${att.url}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-border/60 bg-muted/40">
                {att.poster ? (
                  <img src={wallSrc(att.poster)} alt={att.name || ""} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileVideo2 className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
                {!readonly && removeBtn}
              </div>
            );
          }
          return (
            <div
              key={`${att.url}-${index}`}
              className="relative col-span-3 flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2"
            >
              <div className="w-9 h-9 rounded-md bg-background/80 flex items-center justify-center shrink-0">
                {att.type === "audio" ? (
                  <Music className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <FileText className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{att.name || "Файл"}</p>
                <p className="text-[11px] text-muted-foreground">{formatSize(att.size)}</p>
              </div>
              {!readonly && removeBtn}
            </div>
          );
        })}
      </div>
    );
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
        // Published — drop the autosaved draft.
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
        setContent("");
        setContentJson(EMPTY_EDITOR_STATE);
        setAttachments([]);
        setEditorResetKey((prev) => prev + 1);
        setRestoredDraft(false);
        toast.success("Пост опубликован");
      }
    } catch (error) {
      console.error("Error saving wall post:", error);
      toast.error(isEditing ? "Ошибка обновления поста" : "Ошибка публикации поста");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Rendered in a portal so the overlay sits at the root stacking context:
  // the profile page main is `isolate`, which would otherwise trap the overlay
  // below the fixed app header (z-50) and let the header cover its top.
  return createPortal(
    // On mobile the sheet only spans to the keyboard top, so the backdrop
    // below it must be opaque — otherwise the page content shows through the
    // (often translucent) keyboard area.
    <div className="fixed inset-0 z-[60] bg-background md:bg-black/50 md:backdrop-blur-[2px] md:flex md:items-center md:justify-center">
      <div
        ref={composerRootRef}
        role="dialog"
        aria-modal="true"
        {...wallDragHandlers}
        className={`fixed inset-x-0 top-0 bottom-[var(--kb-inset)] md:static flex flex-col w-full md:h-auto md:max-h-[85vh] md:max-w-2xl md:rounded-2xl md:border md:border-border/60 md:shadow-2xl bg-background md:bg-card overflow-hidden transition-[transform,opacity] duration-300 ease-out animate-in slide-in-from-bottom-full md:slide-in-from-bottom-8 ${
          // On close the sheet detaches from the (still animating) keyboard
          // inset and covers the full screen, so translate-y-full slides it
          // cleanly off while the keyboard retracts behind it — otherwise the
          // shrinking --kb-inset changes the panel height mid-slide and the
          // motion looks janky.
          closing ? "translate-y-full !bottom-0 md:translate-y-0 md:opacity-0" : "translate-y-0 md:opacity-100"
        }`}
        data-testid="wall-post-composer"
      >
        {/* Drag & drop attach hint covering the whole composer */}
        {isWallDragging && attachments.length < MAX_WALL_ATTACHMENTS && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-background/60 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary/25 bg-card px-8 py-6 shadow-xl">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Paperclip className="h-6 w-6" />
              </div>
              <span className="text-sm font-semibold text-foreground">Отпустите, чтобы прикрепить</span>
              <span className="text-xs text-muted-foreground">Фото, видео и файлы появятся в записи</span>
            </div>
          </div>
        )}

        {/* Header — close, destination, preview */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border/60 shrink-0">
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="p-2 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground active:scale-95 transition"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 text-center px-1">
            <span className="text-sm font-semibold truncate">
              {isEditing ? "Редактирование записи" : "Новая запись на стене"}
            </span>
            {!isEditing && restoredDraft && (
              <span className="ml-2 text-[11px] text-muted-foreground/70 whitespace-nowrap">черновик</span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-muted-foreground"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <PenLine className="h-4 w-4 mr-1.5" /> : <Eye className="h-4 w-4 mr-1.5" />}
            {showPreview ? "Редактировать" : "Предпросмотр"}
          </Button>
        </div>

        {/* Editor / live preview */}
        <div
          className="flex-1 min-h-0 px-4 pb-2 overflow-y-auto"
          onClick={(e) => {
            if (showPreview) return;
            // The tiptap editable is smaller than this pane — clicking the
            // dead space below/around it should focus the editor, not do
            // nothing.
            const target = e.target as HTMLElement;
            if (target.closest("[contenteditable]")) return;
            if (target.closest("button, a, input, [data-radix-popper-content-wrapper]")) return;
            editorRef.current?.focus();
          }}
        >
          {showPreview ? (
            <div className="py-2 pb-4">
              {contentJson ? (
                <RichContentRenderer contentJson={contentJson} />
              ) : (
                content.trim() && <p className="text-sm sm:text-base text-foreground/90 whitespace-pre-wrap break-words">{content}</p>
              )}
              {renderAttachmentsGrid(true)}
              {!content.trim() && !contentJson && attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">Пока пусто — начните писать.</p>
              )}
            </div>
          ) : (
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
              autoFocus
              placeholder="Что у вас нового? Напишите красиво, добавьте теги, эмодзи и вложения."
              minHeightClassName="min-h-[160px]"
              maxHeightClassName="max-h-full"
            />
          )}
        </div>

        {/* Attachments grid */}
        {attachments.length > 0 && !showPreview && (
          <div className="px-4 pb-2 shrink-0">{renderAttachmentsGrid(false)}</div>
        )}

        {/* Toolbar */}
        <div className="px-2 py-1.5 border-t border-border/60 flex items-center gap-0.5 shrink-0">
          <EmojiPicker
            onEmojiSelect={handleEmojiSelect}
            triggerRef={emojiButtonRef}
            keyboardSwap
            swapOpen={emojiSwap.open}
            swapHeight={emojiSwap.height}
            onSwapToggle={emojiSwap.toggle}
            onSwapClose={() => emojiSwap.closePanel(false)}
          >
            <Button
              ref={emojiButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground"
              title="Эмодзи"
            >
              <Smile className="h-5 w-5" />
            </Button>
          </EmojiPicker>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            title="Вложения"
            disabled={uploading || attachments.length >= MAX_WALL_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="composer-file-input"
            onChange={handleFiles}
          />
          <div className="flex-1" />
          <PublishButton
            style={publishButtonStyle}
            creating={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
            label={isEditing ? "Сохранить" : "Опубликовать"}
          />
        </div>
      </div>

      {showGallery && imageAttachments.length > 0 && (
        <Lightbox
          bucket="wall"
          items={imageAttachments.map((att) => ({ url: wallSrc(att.url) || "", type: "image", name: att.name || "Фото", mime: "image/*" } as LightboxItem))}
          initialIndex={galleryIndex}
          onClose={() => setShowGallery(false)}
          onEditImage={(idx, dataUrl) => {
            setAttachments((prev) => {
              let imageIdx = -1;
              return prev.map((att) => {
                if (att.type === "image") {
                  imageIdx += 1;
                  if (imageIdx === idx) {
                    return { ...att, url: dataUrl };
                  }
                }
                return att;
              });
            });
          }}
        />
      )}
    </div>,
    document.body
  );
};
