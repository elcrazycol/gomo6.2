// RichComposer — the shared "profile-grade" composer.
//
// Extracted from CreateWallPostInline so the wall, g-sub posts and global
// topics all edit with the same machine: media blocks living inside the
// document (not a separate attachment list), slash commands, link cards,
// spoilers, YouTube embeds, drag & drop, an in-place image editor and a
// fullscreen mode. The wall composer keeps its own persistence; g-sub and
// topic composers pass `onPublish` and let this component own the editing UX.
//
// The parent owns everything the composer cannot know: the header destination,
// any extra fields (a title input, topic tags) rendered through `children`, and
// the actual submit side effect via `onPublish`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "@/integrations/api/client";
import { Popover, PopoverPanel, PopoverTrigger } from "@/components/ui/popover";
import { InkBar, InkButton, glassGhostButtonClass } from "@/components/ui/ink-bar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { PublishButton } from "@/components/PublishButton";
import { getPublishButtonStyle } from "@/lib/publishButtonStyle";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Expand, Link2, Loader2, Minimize2, Paperclip, Smile, X } from "lucide-react";

import { uploadAttachments, uploadEditedDataUrl } from "@/utils/mediaUpload";
import { storageUrl } from "@/utils/storage";
import {
  EMPTY_EDITOR_STATE,
  prosemirrorToPlainText,
  stripEdgeEmptyParagraphs,
} from "@/utils/contentConverter";

import { mediaExtensions } from "@/components/editor/media/mediaExtensions";
import { createSlashCommand } from "@/components/editor/slash/slashCommands";
import { insertLinkCard } from "@/components/editor/link/linkCommands";
import { insertSpoilerBlock } from "@/components/editor/spoiler/spoilerCommands";
import { insertYouTubeEmbed } from "@/components/editor/youtube/youtubeCommands";
import { parseYouTubeId } from "@/components/editor/youtube/youtubeSchema";
import { isCardableUrl, linkHost } from "@/components/editor/link/linkCardSchema";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import { MediaEditorProvider } from "@/components/editor/media/mediaEditorContext";
import {
  countMediaNodes as countEditorMediaNodes,
  insertMediaGroupWithPlaceholders,
  insertUploadPlaceholders,
  replaceUploadPlaceholder,
  updateUploadPlaceholder,
} from "@/components/editor/media/mediaCommands";
import {
  MAX_MEDIA_NODES,
  collectMediaAttachmentIds,
  countMediaNodes,
  ensureAttachmentIds,
  getDocCover,
  hasUploadPlaceholders,
  makeUploadId,
  mediaBlockAttrsFromAttachment,
  naturalWidthPercent,
  stripUploadPlaceholders,
  withDocCover,
  type DocCover,
  type MediaAttachment,
  type MediaKind,
} from "@/components/editor/media/mediaSchema";

export interface RichComposerPayload {
  /** Final ProseMirror document (upload placeholders stripped, cover attached). */
  json: unknown;
  /** Plain-text projection of `json`. */
  text: string;
  /** Attachments actually referenced by the document. */
  attachments: MediaAttachment[];
  /** Post cover chosen from the document images, if any. */
  cover: DocCover | null;
}

interface RichComposerProps {
  /** Storage bucket uploads go to (e.g. "wall", "content"). */
  bucket: string;
  /** Center header text (destination, editing state…). */
  headerLabel: React.ReactNode;
  /** Small muted text next to the label (e.g. "черновик"). */
  headerMeta?: React.ReactNode;
  /** Extra header content, right of the fullscreen button. */
  headerRight?: React.ReactNode;
  /** Extra content between the header and the editor (title input, tags…). */
  children?: React.ReactNode;
  placeholder?: string;
  /** Plain-text cap; omit for no limit. */
  maxLength?: number;
  /** Max media nodes in the document; defaults to MAX_MEDIA_NODES. */
  maxMedia?: number;
  /** localStorage key — when set the composer autosaves/restores a draft. */
  draftKey?: string;
  initialContentJson?: unknown;
  initialLegacyContent?: string;
  initialAttachments?: MediaAttachment[];
  /** Reported on every editor change (let the parent autosave title etc.). */
  onChange?: (value: { json: unknown; text: string }) => void;
  /** Extra toolbar buttons rendered before the emoji picker. */
  toolbarLeading?: React.ReactNode;
  publishLabel?: string;
  /** External disable (e.g. the parent's title is empty). */
  publishDisabled?: boolean;
  /** Suspend the Escape-to-close handler (e.g. while a picker dialog is open). */
  escapeDisabled?: boolean;
  /** Reset the editor to empty after a successful publish (wall behaviour). */
  resetOnPublish?: boolean;
  onPublish: (payload: RichComposerPayload) => void | Promise<void>;
  onClose: () => void;
  /** Root test id. */
  testId?: string;
}

interface ComposerDraft {
  contentJson: unknown;
  attachments?: MediaAttachment[] | null;
}

const readDraft = (key: string): ComposerDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ComposerDraft;
  } catch {
    // corrupt draft — ignore
  }
  return null;
};

const previewKind = (file: File): MediaKind => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

export const RichComposer = ({
  bucket,
  headerLabel,
  headerMeta,
  headerRight,
  children,
  placeholder = "Что нового? Пишите, двигайте фото и видео прямо в тексте…",
  maxLength,
  maxMedia = MAX_MEDIA_NODES,
  draftKey,
  initialContentJson,
  initialLegacyContent,
  initialAttachments,
  onChange,
  toolbarLeading,
  publishLabel = "Опубликовать",
  publishDisabled = false,
  escapeDisabled = false,
  resetOnPublish = false,
  onPublish,
  onClose,
  testId,
}: RichComposerProps) => {
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);

  // Draft is read once per mount (create mode only).
  const initialDraft = useMemo(() => (draftKey ? readDraft(draftKey) : null), [draftKey]);

  const [contentJson, setContentJson] = useState<unknown>(
    () => initialDraft?.contentJson ?? initialContentJson ?? EMPTY_EDITOR_STATE,
  );
  const [cover, setCoverState] = useState<DocCover | null>(() =>
    getDocCover(initialDraft?.contentJson ?? initialContentJson),
  );
  const [attachments, setAttachments] = useState<MediaAttachment[]>(() =>
    initialDraft ? ensureAttachmentIds(initialDraft.attachments ?? []) : initialAttachments ?? [],
  );
  const [restoredDraft, setRestoredDraft] = useState(Boolean(initialDraft));
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number; startInEditMode: boolean } | null>(null);
  const [publishButtonStyle] = useState(getPublishButtonStyle);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [spoilerDialogOpen, setSpoilerDialogOpen] = useState(false);
  const [spoilerLabelDraft, setSpoilerLabelDraft] = useState("");
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const minSizeRef = useRef<{ w: number; h: number } | null>(null);

  const editorExtensions = useMemo(
    () => [
      ...mediaExtensions,
      createSlashCommand({
        requestMedia: () => fileInputRef.current?.click(),
        requestLinkCard: () => setLinkDialogOpen(true),
        requestSpoiler: () => setSpoilerDialogOpen(true),
        requestYouTube: () => setYoutubeDialogOpen(true),
      }),
    ],
    [],
  );

  const imageAttachments = useMemo(() => attachments.filter((att) => att.type === "image"), [attachments]);
  const imageGallery: LightboxItem[] = useMemo(
    () =>
      imageAttachments.map((att) => ({
        url: storageUrl(bucket, att.url) || att.url,
        type: "image" as const,
        name: att.name || "Фото",
        mime: att.mime || "image/*",
        meta: att.meta ? JSON.stringify(att.meta) : null,
      })),
    [imageAttachments, bucket],
  );

  const uploading = hasUploadPlaceholders(contentJson);
  const mediaCount = useMemo(() => countMediaNodes(contentJson), [contentJson]);
  const referencedIds = useMemo(() => new Set(collectMediaAttachmentIds(contentJson)), [contentJson]);

  useEffect(() => {
    if (cover && !referencedIds.has(cover.id)) setCoverState(null);
  }, [cover, referencedIds]);

  const handleSetCover = useCallback(
    (attachmentId: string | null, placements: DocCover["placements"]) => {
      if (!attachmentId || placements.length === 0) setCoverState(null);
      else setCoverState({ id: attachmentId, placements });
    },
    [],
  );

  const plainText = useMemo(
    () => prosemirrorToPlainText(contentJson, "").replace(/\u200b/g, "").trim(),
    [contentJson],
  );
  const canSubmit = (plainText.length > 0 || referencedIds.size > 0) && !uploading && !isSubmitting && !publishDisabled;

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    window.setTimeout(() => onClose(), 280);
  }, [closing, onClose]);

  // Escape closes (unless a lightbox or another dialog owns Escape then).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lightbox && !escapeDisabled) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, lightbox, escapeDisabled]);

  // Autosave draft (debounced). Placeholders are stripped — their blob previews
  // cannot survive a reload.
  useEffect(() => {
    if (!draftKey) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const stored: ComposerDraft = {
        contentJson: withDocCover(stripEdgeEmptyParagraphs(stripUploadPlaceholders(contentJson)), cover),
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
  }, [draftKey, contentJson, attachments, referencedIds, cover]);

  const handleEditorChange = useCallback(
    (json: unknown, text: string) => {
      setContentJson(json);
      onChange?.({ json, text });
    },
    [onChange],
  );

  // ── Uploads ───────────────────────────────────────────────────────────────
  const runUploads = useCallback(
    async (
      editor: NonNullable<ReturnType<GomoRichEditorHandle["getEditor"]>>,
      pending: Array<{ uploadId: string; file: File }>,
    ) => {
      for (const item of pending) {
        if (editor.isDestroyed) return;
        try {
          const [uploaded] = await uploadAttachments([item.file], bucket, (progress) => {
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
          console.error("Composer media upload failed", error);
          if (!editor.isDestroyed) {
            updateUploadPlaceholder(editor, item.uploadId, { error: "Не удалось загрузить", phase: "done" });
          }
          toast.error("Не удалось загрузить файл");
        }
      }
    },
    [bucket],
  );

  const uploadFiles = useCallback(
    (files: File[], at?: number | null) => {
      const editor = editorRef.current?.getEditor();
      if (!editor || files.length === 0) return;
      const freeSlots = maxMedia - countEditorMediaNodes(editor);
      if (freeSlots <= 0) {
        toast.error(`Максимум ${maxMedia} медиа в записи`);
        return;
      }
      const chosen = files.slice(0, freeSlots);
      if (chosen.length < files.length) {
        toast.error(`Максимум ${maxMedia} медиа в записи`);
      }
      const pending = chosen.map((file) => ({ uploadId: makeUploadId(), kind: previewKind(file), name: file.name }));
      if (pending.length > 1) {
        insertMediaGroupWithPlaceholders(editor, pending, at ?? undefined);
      } else {
        insertUploadPlaceholders(editor, pending, at ?? undefined);
      }
      void runUploads(
        editor,
        pending.map((item, index) => ({ uploadId: item.uploadId, file: chosen[index] })),
      );
    },
    [runUploads, maxMedia],
  );

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    uploadFiles(files, null);
  };

  const handleRootDrop = (event: React.DragEvent) => {
    setIsDragging(false);
    if (event.defaultPrevented) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    uploadFiles(files, null);
  };

  const replaceAttachment = useCallback(
    async (attachmentId: string, file: File): Promise<MediaAttachment | null> => {
      try {
        const [uploaded] = await uploadAttachments([file], bucket);
        const attachment = ensureAttachmentIds([uploaded])[0];
        setAttachments((prev) => prev.map((att) => (att.id === attachmentId ? attachment : att)));
        return attachment;
      } catch (error) {
        console.error("Composer media replace failed", error);
        toast.error("Не удалось заменить файл");
        return null;
      }
    },
    [bucket],
  );

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
      const uploaded = await uploadEditedDataUrl(dataUrl, bucket);
      setAttachments((prev) => prev.map((att) => (att.id === target.id ? { ...uploaded, id: target.id } : att)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить фото");
    }
  };

  // ── Link card ─────────────────────────────────────────────────────────────
  const handleCreateLinkCard = async () => {
    const editor = editorRef.current?.getEditor();
    const raw = linkUrl.trim();
    if (!editor || !raw) return;
    if (!isCardableUrl(raw)) {
      toast.error("Вставьте ссылку, начинающуюся с http(s)://");
      return;
    }
    setLinkLoading(true);
    try {
      type LinkPreviewData = { url?: string; title?: string; description?: string; image?: string; site_name?: string };
      const response = await apiClient.rawRequest<{ data?: LinkPreviewData }>("/api/v1/link-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const payload = Array.isArray(response) ? response[0] : response;
      const data = payload?.data ?? {};
      insertLinkCard(editor, {
        url: data.url || raw,
        title: data.title || raw,
        description: data.description || "",
        image: data.image || null,
        siteName: data.site_name || linkHost(raw),
      });
      toast.success("Карточка добавлена");
    } catch (error) {
      console.error("link preview failed", error);
      insertLinkCard(editor, { url: raw, title: raw, description: "", image: null, siteName: linkHost(raw) });
      toast.message("Предпросмотр недоступен — добавили обычную ссылку");
    } finally {
      setLinkLoading(false);
      setLinkDialogOpen(false);
      setLinkUrl("");
    }
  };

  const handleCreateSpoiler = () => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    insertSpoilerBlock(editor, spoilerLabelDraft);
    setSpoilerDialogOpen(false);
    setSpoilerLabelDraft("");
  };

  const handleCreateYouTube = () => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const videoId = parseYouTubeId(youtubeUrl);
    if (!videoId) {
      toast.error("Не удалось распознать ссылку на YouTube");
      return;
    }
    insertYouTubeEmbed(editor, videoId);
    setYoutubeDialogOpen(false);
    setYoutubeUrl("");
  };

  // ── Composer resize (desktop, bottom-right corner) ───────────────────────
  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const panel = composerRootRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    if (!minSizeRef.current) minSizeRef.current = { w: rect.width, h: rect.height };
    const min = minSizeRef.current;
    const startW = rect.width;
    const startH = rect.height;
    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      const maxW = Math.max(min.w, window.innerWidth - 32);
      const maxH = Math.max(min.h, window.innerHeight - 32);
      const w = Math.min(maxW, Math.max(min.w, startW + (moveEvent.clientX - startX)));
      const h = Math.min(maxH, Math.max(min.h, startH + (moveEvent.clientY - startY)));
      setSize({ w, h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // ── Publish ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const editor = editorRef.current?.getEditor();
    if (!editor || isSubmitting) return;
    if (uploading) {
      toast.error("Дождитесь загрузки файлов");
      return;
    }

    const json = withDocCover(stripEdgeEmptyParagraphs(stripUploadPlaceholders(editor.getJSON())), cover);
    const text = prosemirrorToPlainText(json, "").replace(/\u200b/g, "").trim();
    const usedIds = new Set(collectMediaAttachmentIds(json));
    const usedAttachments = attachments.filter((att) => usedIds.has(att.id));
    if (!text && usedAttachments.length === 0) {
      toast.error("Добавьте текст или медиа");
      return;
    }

    setIsSubmitting(true);
    try {
      await onPublish({ json, text, attachments: usedAttachments, cover });
      if (resetOnPublish) {
        setContentJson(EMPTY_EDITOR_STATE);
        setAttachments([]);
        setEditorResetKey((prev) => prev + 1);
        setRestoredDraft(false);
      }
      if (draftKey) {
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const atLimit = mediaCount >= maxMedia;

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
        data-testid={testId}
        style={size && !fullscreen ? { width: `${size.w}px`, height: `${size.h}px`, maxWidth: "none", maxHeight: "none" } : undefined}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
            event.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleRootDrop}
        className={`group/panel fixed inset-x-0 top-0 bottom-0 flex w-full flex-col overflow-hidden bg-background transition-transform duration-300 md:relative md:border md:border-border/60 md:bg-card md:shadow-2xl ${
          fullscreen
            ? "md:h-[100dvh] md:max-h-none md:max-w-none md:rounded-none"
            : "md:h-auto md:max-h-[85vh] md:max-w-2xl md:rounded-2xl"
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
            title="Закрыть"
            className={`${glassGhostButtonClass} active:scale-95`}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate px-1 text-center">
            <span className="text-sm font-semibold">{headerLabel}</span>
            {restoredDraft && (
              <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">черновик</span>
            )}
            {headerMeta && <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">{headerMeta}</span>}
          </div>
          {headerRight}
          <button
            type="button"
            title={fullscreen ? "Свернуть" : "На весь экран"}
            onClick={() => setFullscreen((prev) => !prev)}
            className={glassGhostButtonClass}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>

        {/* Extra fields (title, topic placement…) */}
        {children}

        {/* Editor — media blocks are edited in place */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-2"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (
              target.closest(
                "a, button, input, textarea, select, [contenteditable='true'], [data-media-toolbar], [data-radix-popper-content-wrapper]",
              )
            ) {
              return;
            }
            editorRef.current?.focus();
          }}
        >
          <MediaAttachmentsProvider value={{ attachments, inlineMedia: true, galleryKey: "draft" }}>
            <MediaEditorProvider
              value={{
                replaceAttachment,
                openImageEditor,
                toggleFullscreen: () => setFullscreen((prev) => !prev),
                canAddMore: !atLimit,
                coverId: cover?.id ?? null,
                coverPlacements: cover?.placements ?? [],
                setCover: handleSetCover,
              }}
            >
              <GomoRichEditor
                ref={editorRef}
                resetKey={editorResetKey}
                maxLength={maxLength}
                contentJson={contentJson}
                legacyContent={initialLegacyContent ?? ""}
                extraExtensions={editorExtensions}
                enableMediaDrop
                onFilesDropped={(files, pos) => uploadFiles(files, pos)}
                onFilesPasted={(files, pos) => uploadFiles(files, pos)}
                onChange={({ json, text }) => handleEditorChange(json, text)}
                onSubmit={handleSubmit}
                placeholder={placeholder}
                minHeightClassName={fullscreen ? "min-h-[70dvh]" : "min-h-[180px]"}
                maxHeightClassName="max-h-full"
              />
            </MediaEditorProvider>
          </MediaAttachmentsProvider>
        </div>

        {/* Toolbar */}
        <InkBar
          blobClassName="h-9 w-9"
          className="flex shrink-0 items-center gap-0.5 border-t border-border/60 py-1.5 pl-2 pr-2 md:pr-7"
        >
          <InkButton
            title="Добавить медиа"
            disabled={isSubmitting || atLimit}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
          </InkButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="inline-media-file-input"
            onChange={handleFiles}
          />
          <EmojiPicker
            onEmojiSelect={(data) => {
              editorRef.current?.focus();
              editorRef.current?.insertEmoji(data);
            }}
          >
            <InkButton title="Эмодзи">
              <Smile className="h-5 w-5" />
            </InkButton>
          </EmojiPicker>
          <Popover
            open={linkDialogOpen}
            onOpenChange={(open) => {
              if (!linkLoading) setLinkDialogOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <InkButton title="Ссылка-карточка" onMouseDown={(event) => event.preventDefault()}>
                <Link2 className="h-5 w-5" />
              </InkButton>
            </PopoverTrigger>
            <PopoverPanel side="top" align="start" className="z-[80] w-80">
              <div className="px-3 py-3">
                <Input
                  autoFocus
                  className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://…"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleCreateLinkCard();
                    }
                  }}
                />
              </div>
              <div className="flex justify-end border-t border-border/60 px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => void handleCreateLinkCard()}
                  disabled={linkLoading || !linkUrl.trim()}
                  className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  {linkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Добавить"}
                </button>
              </div>
            </PopoverPanel>
          </Popover>
          {toolbarLeading}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {mediaCount > 0 ? `${mediaCount}/${maxMedia}` : null}
          </span>
          <div className="flex-1" />
          <PublishButton
            style={publishButtonStyle}
            creating={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
            label={publishLabel}
          />
        </InkBar>

        <div
          role="separator"
          aria-label="Изменить размер окна"
          title="Потяните, чтобы изменить размер"
          onPointerDown={handleResizeStart}
          className="absolute bottom-0 right-0 z-40 hidden h-6 w-6 cursor-nwse-resize items-end justify-end p-1 md:flex"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
            className="text-muted-foreground/50 transition-colors group-hover/panel:text-muted-foreground"
          >
            <path d="M13 5 L5 13 M13 10 L10 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {lightbox && (
        <Lightbox
          bucket={bucket}
          items={lightbox.items}
          initialIndex={lightbox.index}
          startInEditMode={lightbox.startInEditMode}
          onClose={() => setLightbox(null)}
          onEditImage={handleEditImage}
        />
      )}

      <Dialog open={spoilerDialogOpen} onOpenChange={setSpoilerDialogOpen}>
        <DialogContent className="z-[70] w-[calc(100vw-2rem)] max-w-sm !gap-0 !p-0 border-border/60 bg-background">
          <div className="border-b border-border/60 px-4 py-3 pr-10 text-sm font-medium">Спойлер</div>
          <div className="px-4 py-4">
            <Input
              autoFocus
              className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
              value={spoilerLabelDraft}
              onChange={(event) => setSpoilerLabelDraft(event.target.value)}
              placeholder="Текст на спойлере"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCreateSpoiler();
                }
              }}
            />
          </div>
          <div className="flex justify-end border-t border-border/60 px-2 py-1.5">
            <button
              type="button"
              onClick={handleCreateSpoiler}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              Добавить
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={youtubeDialogOpen} onOpenChange={setYoutubeDialogOpen}>
        <DialogContent className="z-[70] w-[calc(100vw-2rem)] max-w-sm !gap-0 !p-0 border-border/60 bg-background">
          <div className="border-b border-border/60 px-4 py-3 pr-10 text-sm font-medium">YouTube</div>
          <div className="px-4 py-4">
            <Input
              autoFocus
              className="h-9 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              placeholder="https://youtu.be/…"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCreateYouTube();
                }
              }}
            />
          </div>
          <div className="flex justify-end border-t border-border/60 px-2 py-1.5">
            <button
              type="button"
              onClick={handleCreateYouTube}
              disabled={!youtubeUrl.trim()}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              Добавить
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
};
