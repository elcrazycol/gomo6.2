// Inline-media wall composer (P1). Behind the `wallInlineMedia` flag, rendered
// next to the legacy CreateWallPost. Media files live inside the document as
// mediaBlock nodes; the attachment pool is sent alongside so the server (P2)
// can validate and derive the legacy fields.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InkBar, InkButton, glassGhostButtonClass } from "@/components/ui/ink-bar";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { PublishButton } from "@/components/PublishButton";
import { getPublishButtonStyle } from "@/lib/publishButtonStyle";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Expand, Link2, Loader2, Minimize2, Paperclip, Smile, X } from "lucide-react";

import { uploadAttachments, uploadEditedDataUrl } from "@/utils/mediaUpload";
import type { AttachmentMeta } from "@/utils/mediaUpload";
import { storageUrl } from "@/utils/storage";
import { EMPTY_EDITOR_STATE, normalizeContent, prosemirrorToPlainText, stripEdgeEmptyParagraphs } from "@/utils/contentConverter";
import { normalizeAttachments, type WallPost } from "@/utils/wallNormalizers";

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
  appendAttachmentsAsMedia,
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
  // Post cover (an image already used in the document + where to show it).
  const [cover, setCoverState] = useState<DocCover | null>(() =>
    getDocCover(initialDraft?.contentJson ?? editingPost?.content_json),
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
  // Link-card dialog state.
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  // Spoiler-block dialog state (label text shown on the collapsed block).
  const [spoilerDialogOpen, setSpoilerDialogOpen] = useState(false);
  const [spoilerLabelDraft, setSpoilerLabelDraft] = useState("");
  // YouTube embed dialog state.
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  // Editor extension pack: media nodes + the slash command menu (its media
  // action opens the composer's hidden file input, the link/spoiler actions
  // open their dialogs).
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
  // Resized composer size (desktop only). null = default (auto) size.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const minSizeRef = useRef<{ w: number; h: number } | null>(null);

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

  // Drop a cover whose media node was removed from the document.
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
  }, [isEditing, draftKey, contentJson, attachments, referencedIds, cover]);

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
      // A multi-file drop/paste becomes a gallery; a single file stays inline.
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
      // Fallback: keep a plain link so the user is not left with nothing.
      insertLinkCard(editor, { url: raw, title: raw, description: "", image: null, siteName: linkHost(raw) });
      toast.message("Предпросмотр недоступен — добавили обычную ссылку");
    } finally {
      setLinkLoading(false);
      setLinkDialogOpen(false);
      setLinkUrl("");
    }
  };

  // ── Spoiler block ─────────────────────────────────────────────────────────
  const handleCreateSpoiler = () => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    insertSpoilerBlock(editor, spoilerLabelDraft);
    setSpoilerDialogOpen(false);
    setSpoilerLabelDraft("");
  };

  // ── YouTube embed ─────────────────────────────────────────────────────────
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
    // The default (current) size is the minimum — remember it once.
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
    onBeforeCreate?.();

    try {
      const firstImage = usedAttachments.find((att) => att.type === "image");
      const coverAttachment = cover
        ? usedAttachments.find((att) => att.id === cover.id && att.type === "image")
        : null;
      const postData = {
        user_id: profileUserId,
        author_id: currentUserId,
        title: deriveTitle(text),
        content: text || null,
        content_json: json,
        image_url: coverAttachment?.url ?? firstImage?.url ?? null,
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
            title="Закрыть"
            className={`${glassGhostButtonClass} active:scale-95`}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate px-1 text-center">
            <span className="text-sm font-semibold">{isEditing ? "Редактирование записи" : "Новая запись на стене"}</span>
            {!isEditing && restoredDraft && (
              <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">черновик</span>
            )}
          </div>
          <button
            type="button"
            title={fullscreen ? "Свернуть" : "На весь экран"}
            onClick={() => setFullscreen((prev) => !prev)}
            className={glassGhostButtonClass}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>

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
                coverId: cover?.id ?? null,
                coverPlacements: cover?.placements ?? [],
                setCover: handleSetCover,
              }}
            >
              <GomoRichEditor
                ref={editorRef}
                resetKey={editorResetKey}
                maxLength={MAX_WALL_POST_LENGTH}
                contentJson={contentJson}
                legacyContent={editingPost?.content ?? ""}
                extraExtensions={editorExtensions}
                enableMediaDrop
                onFilesDropped={(files, pos) => uploadFiles(files, pos)}
                onFilesPasted={(files, pos) => uploadFiles(files, pos)}
                onChange={({ json }) => setContentJson(json)}
                onSubmit={handleSubmit}
                placeholder="Что нового? Пишите, двигайте фото и видео прямо в тексте…"
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
            <PopoverContent side="top" align="start" className="z-[80] w-80 !p-0">
              <div className="border-b border-border/60 px-3 py-2 text-sm font-medium">Ссылка-карточка</div>
              <div className="space-y-2 px-3 py-3">
                <Input
                  autoFocus
                  className="h-9"
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
                <p className="text-[11px] leading-4 text-muted-foreground">Вставьте ссылку — покажем предпросмотр.</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/60 px-3 py-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setLinkDialogOpen(false)} disabled={linkLoading}>
                  Отмена
                </Button>
                <Button type="button" size="sm" onClick={() => void handleCreateLinkCard()} disabled={linkLoading || !linkUrl.trim()}>
                  {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Добавить"}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
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
        </InkBar>

        {/* Desktop resize handle (bottom-right): drag to resize the composer.
            The default size is the minimum. */}
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
          bucket="wall"
          items={lightbox.items}
          initialIndex={lightbox.index}
          startInEditMode={lightbox.startInEditMode}
          onClose={() => setLightbox(null)}
          onEditImage={handleEditImage}
        />
      )}

      <Dialog open={spoilerDialogOpen} onOpenChange={setSpoilerDialogOpen}>
        <DialogContent className="z-[70] max-w-md border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>Спойлер</DialogTitle>
            <DialogDescription>
              Введите текст на спойлере — его увидят до того, как раскроют блок.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={spoilerLabelDraft}
            onChange={(event) => setSpoilerLabelDraft(event.target.value)}
            placeholder="Спойлер"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleCreateSpoiler();
              }
            }}
          />
          <DialogFooter className="gap-2 sm:justify-end sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setSpoilerDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={handleCreateSpoiler}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={youtubeDialogOpen} onOpenChange={setYoutubeDialogOpen}>
        <DialogContent className="z-[70] max-w-md border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>YouTube</DialogTitle>
            <DialogDescription>Вставьте ссылку на видео — встроим плеер.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
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
          <DialogFooter className="gap-2 sm:justify-end sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setYoutubeDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={handleCreateYouTube} disabled={!youtubeUrl.trim()}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
};
