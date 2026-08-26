import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileAudio2, FileText, FileVideo2, Image as ImageIcon, Loader2, Scissors, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { AttachmentMeta } from "@/types/forum";
import { uploadAttachments, uploadEditedDataUrl } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";
import { storageUrl } from "@/utils/storage";
import { AudioAttachment } from "@/components/AudioAttachment";
import { FileDropZone } from "@/components/FileDropZone";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { UploadProgressChip, type UploadingFileLike } from "@/components/UploadProgressChip";
import { chipMotion, itemMotion } from "@/components/uploadMotions";

interface ProfileAttachmentUploadProps {
  value: AttachmentMeta[];
  onChange: (attachments: AttachmentMeta[]) => void;
  maxFiles?: number;
  /**
   * Storage bucket for the uploads. Defaults to the public "content" bucket
   * (threads/posts). Wall attachments pass bucket="wall" so photos land in the
   * private, authorization-gated bucket.
   */
  bucket?: string;
  /**
   * Set false when a parent (e.g. the wall-post composer) owns the drop zone —
   * then the button keeps working but no drag handlers are attached here, so
   * drops are handled once by the parent.
   */
  dropZone?: boolean;
  /**
   * Enable the photo editor (crop / brush / blur) on draft photos: image
   * thumbnails gain an edit button that opens the shared lightbox in edit
   * mode, and the edited data URL replaces the photo in `value` before it is
   * sent.
   */
  editable?: boolean;
}

export interface ProfileAttachmentUploadHandle {
  /** Start uploading files through the same pipeline as the paperclip button. */
  attachFiles: (files: File[]) => void;
}

interface UploadingFile extends UploadingFileLike {
  type: "image" | "video" | "audio" | "file";
}

const iconFor = (type: string) => {
  switch (type) {
    case "image":
      return <ImageIcon className="w-4 h-4" />;
    case "video":
      return <FileVideo2 className="w-4 h-4" />;
    case "audio":
      return <FileAudio2 className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const typeOf = (file: File): UploadingFile["type"] =>
  file.type.startsWith("image/") ? "image"
    : file.type.startsWith("video/") ? "video"
    : file.type.startsWith("audio/") ? "audio"
    : "file";

/** Resolve the display URL for an attachment inside the given bucket. */
const attachmentSrc = (bucket: string, att: AttachmentMeta): string => {
  const preview = att.meta?.preview_key || att.url;
  return storageUrl(bucket, preview) || storageUrl(bucket, att.url) || att.url;
};

export const ProfileAttachmentUpload = forwardRef<ProfileAttachmentUploadHandle, ProfileAttachmentUploadProps>(
  function ProfileAttachmentUpload(
    { value, onChange, maxFiles = 6, bucket = "content", dropZone = true, editable = false }: ProfileAttachmentUploadProps,
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
    const [editImageIndex, setEditImageIndex] = useState<number | null>(null);
    // Always-fresh mirror of `value` so in-flight uploads can append without
    // racing against a stale render-time snapshot (drops can land on the card
    // while a button upload is still running).
    const valueRef = useRef(value);
    valueRef.current = value;
    const holdTimersRef = useRef<number[]>([]);
    // Ids of chips the user cancelled — those uploads still run to completion
    // server-side but their results are dropped, so cancel really means cancel.
    const cancelledRef = useRef<Set<string>>(new Set());

    useEffect(() => {
      clearMediaCache();
      const timers = holdTimersRef.current;
      return () => {
        timers.forEach((t) => window.clearTimeout(t));
      };
    }, []);

    const handleSelect = () => {
      if (value.length >= maxFiles) {
        return;
      }
      inputRef.current?.click();
    };

    // Shared upload path for the paperclip button, drag & drop and Ctrl+V
    // (via attachFiles). Reports real byte progress through uploadAttachments.
    const processFiles = useCallback(
      async (files: File[]) => {
        if (files.length === 0) return;
        if (value.length + files.length > maxFiles) return;

        setUploading(true);
        const newUploadingFiles: UploadingFile[] = files.map((file) => ({
          id: Math.random().toString(36).slice(2, 11),
          file,
          progress: 0,
          name: file.name,
          type: typeOf(file),
          phase: "upload",
        }));

        setUploadingFiles((prev) => [...prev, ...newUploadingFiles]);

        try {
          const uploaded = await uploadAttachments(files, bucket, (progress) => {
            const entry = newUploadingFiles[progress.index];
            if (!entry || cancelledRef.current.has(entry.id)) return;
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === entry.id ? { ...f, progress: progress.percent, phase: progress.phase } : f))
            );
          });
          // Drop results for chips the user cancelled mid-flight.
          const kept = uploaded.filter((_, i) => !cancelledRef.current.has(newUploadingFiles[i]?.id));
          if (kept.length > 0) {
            onChange([...valueRef.current, ...kept]);
          }

          // Hold the chips at 100% briefly so the user sees the check before
          // they fade out into the freshly added thumbnails.
          newUploadingFiles.forEach((entry) => {
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === entry.id ? { ...f, progress: 100, phase: "done" } : f))
            );
          });
          const timer = window.setTimeout(() => {
            setUploadingFiles((prev) =>
              prev.filter((f) => !newUploadingFiles.some((nf) => nf.id === f.id))
            );
          }, 500);
          holdTimersRef.current.push(timer);
        } catch (error) {
          console.error("Upload error:", error);
          toast.error((error instanceof Error ? error.message : String(error)) || "Не удалось загрузить файл");
          setUploadingFiles((prev) => prev.filter((f) => !newUploadingFiles.some((nf) => nf.id === f.id)));
        } finally {
          setUploading(false);
        }
      },
      [value, bucket, maxFiles, onChange]
    );

    const attachFiles = useCallback(
      (files: File[]) => {
        void processFiles(files);
      },
      [processFiles]
    );

    useImperativeHandle(ref, () => ({ attachFiles }), [attachFiles]);

    const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      await processFiles(files);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    };

    const handleRemove = (index: number) => {
      const updated = value.filter((_, i) => i !== index);
      onChange(updated);
    };

    const removeUploadingFile = (id: string) => {
      cancelledRef.current.add(id);
      setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
    };

    // Draft-image editing: the edit button on a thumbnail opens the shared
    // photo editor on the photo before it is sent. The lightbox counts photos
    // only, so the clicked attachment is mapped to the image-only list.
    const openImageEditor = (attachmentIndex: number) => {
      const clicked = value[attachmentIndex];
      if (!clicked || clicked.type !== "image") return;
      const inImageList = value.filter((att) => att.type === "image").findIndex((att) => att === clicked);
      setEditImageIndex(inImageList);
    };
    const handleApplyImageEdit = useCallback(
      async (imageIndex: number, dataUrl: string) => {
        const images = value.filter((att) => att.type === "image");
        const target = images[imageIndex];
        if (!target) return;
        try {
          // The edited photo must be uploaded like any picked file — draft
          // urls are storage keys, and a raw data URL would break rendering
          // and the final save.
          const uploaded = await uploadEditedDataUrl(dataUrl, bucket);
          onChange(value.map((att) => (att.url === target.url ? { ...att, url: uploaded.url, meta: uploaded.meta } : att)));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Не удалось сохранить отредактированное фото");
        } finally {
          setEditImageIndex(null);
        }
      },
      [value, onChange, bucket]
    );

    const lightboxItems = useMemo<LightboxItem[]>(
      () =>
        value
          .filter((att) => att.type === "image")
          .map((att) => ({
            url: attachmentSrc(bucket, att),
            type: "image" as const,
            name: att.name || "Фото",
            mime: att.mime || "image/*",
            // LightboxItem.meta is the JSON-string shape the messenger uses.
            meta: att.meta ? JSON.stringify(att.meta) : null,
          })),
      [value, bucket]
    );

    const renderContent = (isDragging: boolean) => (
      <div className="space-y-3">
        {/* Компактная кнопка */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx"
          multiple
          className="hidden"
          data-testid="attachment-upload-input"
          onChange={handleFiles}
        />
        <button
          type="button"
          onClick={handleSelect}
          disabled={uploading}
          className={`h-9 w-9 rounded-md border flex items-center justify-center transition-colors disabled:opacity-50 ${
            isDragging
              ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/40"
              : "border-border/70 bg-background hover:bg-muted"
          }`}
          aria-label="Добавить файл"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        </button>

        {/* Загружаемые файлы — чипы с живым прогрессом */}
        <AnimatePresence initial={false}>
          {uploadingFiles.map((uploadingFile) => (
            <motion.div key={uploadingFile.id} layout className="overflow-hidden" {...chipMotion}>
              <UploadProgressChip file={uploadingFile} onCancel={removeUploadingFile} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Уже загруженные файлы */}
        {value.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {value.map((attachment, index) => (
                <motion.div key={`${attachment.url}-${index}`} layout className="relative" {...itemMotion}>
                  {attachment.type === "image" ? (
                    <div className="group relative h-20 w-20 sm:h-24 sm:w-24 rounded-lg overflow-hidden border border-border/60 bg-muted/20">
                      <img
                        src={attachmentSrc(bucket, attachment)}
                        alt={attachment.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {editable && (
                        <button
                          onClick={() => openImageEditor(index)}
                          className="absolute bottom-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity hover:bg-black/80"
                          aria-label="Редактировать фото"
                          title="Кадрировать · Кисть · Размытие"
                        >
                          <Scissors className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(index)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity hover:bg-black/80"
                        aria-label="Удалить"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : attachment.type === "video" ? (
                    <div className="group relative h-20 w-32 overflow-hidden rounded-lg border border-border/60 bg-muted/30 sm:h-24 sm:w-40">
                      {attachment.poster ? (
                        <img src={attachmentSrc(bucket, { ...attachment, url: attachment.poster })} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground"><FileVideo2 className="h-5 w-5" /></div>
                      )}
                      <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">Видео</span>
                      <button onClick={() => handleRemove(index)} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" aria-label="Удалить"><X className="h-3 w-3" /></button>
                    </div>
                  ) : attachment.type === "audio" ? (
                    <div className="w-full">
                      <AudioAttachment
                        attachment={attachment}
                        showPlayer={false}
                        className="max-w-xs"
                      />
                      <button
                        onClick={() => handleRemove(index)}
                        className="absolute -top-2 -right-2 flex-shrink-0 p-1 hover:bg-muted rounded transition-colors bg-background border border-border/60 shadow-sm"
                        aria-label="Удалить"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-muted/10 rounded-lg border border-border/30 min-w-0 max-w-full">
                      <div className="flex-shrink-0 w-8 h-8 rounded-md bg-background border border-border/60 flex items-center justify-center text-muted-foreground">
                        {iconFor(attachment.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{attachment.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(attachment.size)}</p>
                      </div>
                      <button
                        onClick={() => handleRemove(index)}
                        className="flex-shrink-0 p-1 hover:bg-muted rounded transition-colors"
                        aria-label="Удалить"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    );

    // The edit lightbox renders as a portal, so it stays outside the drop zone.
    const renderUploadUi = (isDragging: boolean) => renderContent(isDragging);

    return (
      <>
        {dropZone ? (
          <FileDropZone onFiles={processFiles} disabled={uploading}>
            {renderUploadUi}
          </FileDropZone>
        ) : (
          renderContent(false)
        )}
        {editImageIndex !== null && lightboxItems.length > 0 && (
          <Lightbox
            items={lightboxItems}
            initialIndex={Math.min(editImageIndex, lightboxItems.length - 1)}
            startInEditMode
            bucket={bucket}
            onEditImage={handleApplyImageEdit}
            onClose={() => setEditImageIndex(null)}
          />
        )}
      </>
    );
  }
);
