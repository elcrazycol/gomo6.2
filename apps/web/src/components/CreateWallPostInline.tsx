// Inline-media wall composer (P1). Behind the `wallInlineMedia` flag, rendered
// next to the legacy CreateWallPost. Media files live inside the document as
// mediaBlock nodes; the attachment pool is sent alongside so the server (P2)
// can validate and derive the legacy fields.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { PublishButton } from "@/components/PublishButton";
import { getPublishButtonStyle } from "@/lib/publishButtonStyle";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Expand, Loader2, Minimize2, Paperclip, Smile, X } from "lucide-react";

import { uploadAttachments, uploadEditedDataUrl } from "@/utils/mediaUpload";
import type { AttachmentMeta } from "@/utils/mediaUpload";
import { storageUrl } from "@/utils/storage";
import { EMPTY_EDITOR_STATE, normalizeContent, prosemirrorToPlainText, stripEdgeEmptyParagraphs } from "@/utils/contentConverter";
import { normalizeAttachments, type WallPost } from "@/utils/wallNormalizers";

import { mediaExtensions } from "@/components/editor/media/mediaExtensions";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { MediaEditorProvider } from "@/components/editor/media/mediaEditorContext";
import {
  countMediaNodes as countEditorMediaNodes,
  insertUploadPlaceholders,
  replaceUploadPlaceholder,
  updateUploadPlaceholder,
} from "@/components/editor/media/mediaCommands";
import {
  MAX_MEDIA_NODES,
  appendAttachmentsAsMedia,
  collectMediaAttachmentIds,
  countMediaNodes,
  ensureAttachmentIds,
  hasUploadPlaceholders,
  makeUploadId,
  mediaBlockAttrsFromAttachment,
  naturalWidthPercent,
  stripUploadPlaceholders,
  type MediaAttachment,
  type MediaKind,
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

interface WallDraftV2 {
  contentJson: unknown;
  attachments?: AttachmentMeta[] | null;
}

const readDraft = (key: string): WallDraftV2 | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as WallDraftV2;
  } catch {
    // corrupt draft — ignore
  }
  return null;
};

const deriveTitle = (content: string): string => {
  const plain = content.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "Пост на стене";
  return plain.length > 80 ? `${plain.slice(0, 77).trimEnd()}...` : plain;
};

const previewKind = (file: File): MediaKind => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

/** A legacy post's attachments become mediaBlocks appended at the end. */
const buildInitialDocument = (editingPost?: WallPost): unknown => {
  const base = normalizeContent(editingPost?.content_json, editingPost?.content ?? "") ?? EMPTY_EDITOR_STATE;
  if (!editingPost) return base;
  return appendAttachmentsAsMedia(base, normalizeAttachments(editingPost));
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
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);

  // Draft is read once per mount and only in create mode.
  const initialDraft = useMemo(() => (isEditing ? null : readDraft(draftKey)), [isEditing, draftKey]);

  const [contentJson, setContentJson] = useState<unknown>(() =>
    initialDraft?.contentJson ?? buildInitialDocument(editingPost),
  );
  const [attachments, setAttachments] = useState<MediaAttachment[]>(() =>
    initialDraft ? ensureAttachmentIds(initialDraft.attachments) : editingPost ? normalizeAttachments(editingPost) : [],
  );
  const [restoredDraft, setRestoredDraft] = useState(Boolean(initialDraft));
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number; startInEditMode: boolean } | null>(null);
  const [publishButtonStyle] = useState(getPublishButtonStyle);

  // Switching which post is edited resets the composer (same mounted instance).
  // Skip the first run: on mount the state already holds the initial document
  // (which may be a restored draft) and must not be clobbered.
  const lastEditingIdRef = useRef<string | undefined>(editingPost?.id);
  useEffect(() => {
    const nextId = editingPost?.id;
    if (lastEditingIdRef.current === nextId) return;
    lastEditingIdRef.current = nextId;
    setContentJson(buildInitialDocument(editingPost));
    setAttachments(editingPost ? normalizeAttachments(editingPost) : []);
    setEditorResetKey((prev) => prev + 1);
  }, [editingPost?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const imageAttachments = useMemo(() => attachments.filter((att) => att.type === "image"), [attachments]);
  const imageGallery: LightboxItem[] = useMemo(
    () =>
      imageAttachments.map((att) => ({
        url: storageUrl("wall", att.url) || att.url,
        type: "image" as const,
        name: att.name || "Фото",
        mime: att.mime || "image/*",
        meta: att.meta ? JSON.stringify(att.meta) : null,
      })),
    [imageAttachments],
  );

  const uploading = hasUploadPlaceholders(contentJson);
  const mediaCount = useMemo(() => countMediaNodes(contentJson), [contentJson]);
  const referencedIds = useMemo(() => new Set(collectMediaAttachmentIds(contentJson)), [contentJson]);
  const plainText = useMemo(
    () => prosemirrorToPlainText(contentJson, "").replace(/\u200b/g, "").trim(),
    [contentJson],
  );
  const canSubmit = (plainText.length > 0 || referencedIds.size > 0) && !uploading && !isSubmitting;

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.setTimeout(() => onCancel(), 280);
  }, [closing, onCancel]);

  // Escape closes (unless a lightbox is open — it owns Escape then).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lightbox) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, lightbox]);

  // Autosave draft (debounced, create mode only). Placeholders are stripped —
  // their blob previews cannot survive a reload.
  useEffect(() => {
    if (isEditing) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const stored: WallDraftV2 = {
        contentJson: stripEdgeEmptyParagraphs(stripUploadPlaceholders(contentJson)),
        attachments: attachments.filter((att) => referencedIds.has(att.id)),
      };
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(stored));
      } catch {
        // storage full — publishing still works
      }
    }, 350);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [isEditing, draftKey, contentJson, attachments, referencedIds]);

  // ── Uploads ───────────────────────────────────────────────────────────────
  const runUploads = useCallback(
    async (
      editor: NonNullable<ReturnType<GomoRichEditorHandle["getEditor"]>>,
      pending: Array<{ uploadId: string; file: File }>,
    ) => {
      for (const item of pending) {
        if (editor.isDestroyed) return;
        try {
          const [uploaded] = await uploadAttachments([item.file], "wall", (progress) => {
            if (editor.isDestroyed) return;
            updateUploadPlaceholder(editor, item.uploadId, {
              percent: progress.percent,
              phase: progress.phase ?? "upload",
            });
          });
          if (editor.isDestroyed) return;
          const attachment = ensureAttachmentIds([uploaded])[0];
          const containerWidth = editor.view.dom.clientWidth || 640;
          const attrs = mediaBlockAttrsFromAttachment(attachment, {
            width: naturalWidthPercent(attachment, containerWidth),
          });
          if (replaceUploadPlaceholder(editor, item.uploadId, attrs)) {
            setAttachments((prev) => [...prev, attachment]);
          }
        } catch (error) {
          console.error("Wall media upload failed", error);
          if (!editor.isDestroyed) {
            updateUploadPlaceholder(editor, item.uploadId, { error: "Не удалось загрузить", phase: "done" });
          }
          toast.error("Не удалось загрузить файл");
        }
      }
    },
    [],
  );

  const uploadFiles = useCallback(
    (files: File[], at?: number | null) => {
      const editor = editorRef.current?.getEditor();
      if (!editor || files.length === 0) return;
      const freeSlots = MAX_MEDIA_NODES - countEditorMediaNodes(editor);
      if (freeSlots <= 0) {
        toast.error(`Максимум ${MAX_MEDIA_NODES} медиа в записи`);
        return;
      }
      const chosen = files.slice(0, freeSlots);
      if (chosen.length < files.length) {
        toast.error(`Максимум ${MAX_MEDIA_NODES} медиа в записи`);
      }
      const pending = chosen.map((file) => ({ uploadId: makeUploadId(), kind: previewKind(file), name: file.name }));
      insertUploadPlaceholders(editor, pending, at ?? undefined);
      void runUploads(
        editor,
        pending.map((item, index) => ({ uploadId: item.uploadId, file: chosen[index] })),
      );
    },
    [runUploads],
  );

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    uploadFiles(files, null);
  };

  // Panel-level drag & drop. The editor handles drops inside the content (and
  // preventDefaults them), so a defaultPrevented event means "already handled".
  const handleRootDrop = (event: React.DragEvent) => {
    setIsDragging(false);
    if (event.defaultPrevented) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    uploadFiles(files, null);
  };

  const replaceAttachment = useCallback(async (attachmentId: string, file: File): Promise<MediaAttachment | null> => {
    try {
      const [uploaded] = await uploadAttachments([file], "wall");
      const attachment = ensureAttachmentIds([uploaded])[0];
      setAttachments((prev) => prev.map((att) => (att.id === attachmentId ? attachment : att)));
      return attachment;
    } catch (error) {
      console.error("Wall media replace failed", error);
      toast.error("Не удалось заменить файл");
      return null;
    }
  }, []);

  const openImageEditor = useCallback(
    (attachmentId: string) => {
      const index = imageAttachments.findIndex((att) => att.id === attachmentId);
      if (index < 0) return;
      setLightbox({ items: imageGallery, index, startInEditMode: true });
    },
    [imageAttachments, imageGallery],
  );

  const handleEditImage = async (index: number, dataUrl: string) => {
    const target = imageAttachments[index];
    if (!target) return;
    try {
      const uploaded = await uploadEditedDataUrl(dataUrl, "wall");
      // Keep the same id so the document node keeps pointing at it.
      setAttachments((prev) => prev.map((att) => (att.id === target.id ? { ...uploaded, id: target.id } : att)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить фото");
    }
  };

  // ── Publish ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const editor = editorRef.current?.getEditor();
    if (!editor || isSubmitting) return;
    if (uploading) {
      toast.error("Дождитесь загрузки файлов");
      return;
    }

    const json = stripEdgeEmptyParagraphs(stripUploadPlaceholders(editor.getJSON()));
    const text = prosemirrorToPlainText(json, "").replace(/\u200b/g, "").trim();
    const usedIds = new Set(collectMediaAttachmentIds(json));
    const usedAttachments = attachments.filter((att) => usedIds.has(att.id));
    if (!text && usedAttachments.length === 0) {
      toast.error("Добавьте текст или медиа");
      return;
    }

    setIsSubmitting(true);
    onBeforeCreate?.();

    try {
      const firstImage = usedAttachments.find((att) => att.type === "image");
      const postData = {
        user_id: profileUserId,
        author_id: currentUserId,
        title: deriveTitle(text),
        content: text || null,
        content_json: json,
        image_url: firstImage?.url ?? null,
        attachments: usedAttachments.length > 0 ? usedAttachments : null,
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
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
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

  const atLimit = mediaCount >= MAX_MEDIA_NODES;

  // Portal: the profile main is `isolate`, which would trap the overlay below
  // the fixed header (z-50).
  return createPortal(
    <div
      className={`fixed inset-0 z-[60] bg-background md:bg-black/50 md:backdrop-blur-[2px] transition-opacity duration-300 ${
        closing ? "opacity-0" : "opacity-100"
      } ${fullscreen ? "" : "md:flex md:items-center md:justify-center"}`}
    >
      <div
        ref={composerRootRef}
        role="dialog"
        aria-modal="true"
        data-testid="wall-post-composer-inline"
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
            event.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleRootDrop}
        className={`fixed inset-x-0 top-0 bottom-0 flex w-full flex-col overflow-hidden bg-background transition-transform duration-300 md:static md:border md:border-border/60 md:bg-card md:shadow-2xl ${
          fullscreen
            ? "md:h-[100dvh] md:max-h-none md:max-w-none md:rounded-none"
            : "md:h-auto md:max-h-[85vh] md:max-w-2xl md:rounded-t-none md:rounded-bl-none md:rounded-br-2xl"
        } ${closing ? "translate-y-full md:translate-y-0 md:opacity-0" : "translate-y-0 md:opacity-100"}`}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary/60 bg-background/60 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-primary/25 bg-card px-8 py-6 shadow-xl">
              <Paperclip className="h-6 w-6 text-primary" />
              <span className="text-sm font-semibold text-foreground">Отпустите, чтобы прикрепить</span>
              <span className="text-xs text-muted-foreground">Медиа появится прямо в записи</span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-2">
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="rounded-full p-2 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate px-1 text-center">
            <span className="text-sm font-semibold">{isEditing ? "Редактирование записи" : "Новая запись на стене"}</span>
            {!isEditing && restoredDraft && (
              <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">черновик</span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            title={fullscreen ? "Свернуть" : "На весь экран"}
            onClick={() => setFullscreen((prev) => !prev)}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </Button>
        </div>

        {/* Editor — media blocks are edited in place */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <MediaAttachmentsProvider
            value={{
              attachments,
              inlineMedia: true,
              galleryKey: editingPost?.id || "draft",
            }}
          >
            <MediaEditorProvider
              value={{
                replaceAttachment,
                openImageEditor,
                toggleFullscreen: () => setFullscreen((prev) => !prev),
                canAddMore: !atLimit,
              }}
            >
              <GomoRichEditor
                ref={editorRef}
                resetKey={editorResetKey}
                maxLength={MAX_WALL_POST_LENGTH}
                contentJson={contentJson}
                legacyContent={editingPost?.content ?? ""}
                extraExtensions={mediaExtensions}
                enableMediaDrop
                onFilesDropped={(files, pos) => uploadFiles(files, pos)}
                onFilesPasted={(files, pos) => uploadFiles(files, pos)}
                onChange={({ json }) => setContentJson(json)}
                onSubmit={handleSubmit}
                placeholder="Что нового? Пишите, двигайте фото и видео прямо в тексте…"
                minHeightClassName="min-h-[180px]"
                maxHeightClassName="max-h-full"
                toolbarClassName="sticky top-0 z-20 bg-background"
              />
            </MediaEditorProvider>
          </MediaAttachmentsProvider>
        </div>

        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-0.5 border-t border-border/60 px-2 py-1.5">
          <EmojiPicker
            onEmojiSelect={(data) => {
              editorRef.current?.focus();
              editorRef.current?.insertEmoji(data);
            }}
          >
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" title="Эмодзи">
              <Smile className="h-5 w-5" />
            </Button>
          </EmojiPicker>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            title="Добавить медиа"
            disabled={isSubmitting || atLimit}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="inline-media-file-input"
            onChange={handleFiles}
          />
          <span className="ml-1 text-[11px] text-muted-foreground">
            {mediaCount > 0 ? `${mediaCount}/${MAX_MEDIA_NODES}` : null}
          </span>
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

      {lightbox && (
        <Lightbox
          bucket="wall"
          items={lightbox.items}
          initialIndex={lightbox.index}
          startInEditMode={lightbox.startInEditMode}
          onClose={() => setLightbox(null)}
          onEditImage={handleEditImage}
        />
      )}
    </div>,
    document.body,
  );
};
