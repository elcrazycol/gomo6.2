import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, FileAudio2, FileText, FileVideo2, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { AttachmentMeta } from "@/types/forum";
import { uploadAttachments } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";
import { storageUrl } from "@/utils/storage";
import { AudioAttachment } from "@/components/AudioAttachment";
import { FileDropZone } from "@/components/FileDropZone";

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
}

export interface ProfileAttachmentUploadHandle {
  /** Start uploading files through the same pipeline as the paperclip button. */
  attachFiles: (files: File[]) => void;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  name: string;
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

// Re-usable animation presets so the upload → thumbnail hand-off is one
// continuous, smooth transition instead of an abrupt swap.
const chipMotion = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0 },
  transition: { duration: 0.22, ease: "easeOut" as const },
};

const thumbMotion = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.85 },
  transition: { duration: 0.2, ease: "easeOut" as const },
};

export const ProfileAttachmentUpload = forwardRef<ProfileAttachmentUploadHandle, ProfileAttachmentUploadProps>(
  function ProfileAttachmentUpload(
    { value, onChange, maxFiles = 6, bucket = "content", dropZone = true }: ProfileAttachmentUploadProps,
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
    // Always-fresh mirror of `value` so in-flight uploads can append without
    // racing against a stale render-time snapshot (drops can land on the card
    // while a button upload is still running).
    const valueRef = useRef(value);
    valueRef.current = value;
    const holdTimersRef = useRef<number[]>([]);

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
        }));

        setUploadingFiles((prev) => [...prev, ...newUploadingFiles]);

        try {
          const uploaded = await uploadAttachments(files, bucket, (progress) => {
            const entry = newUploadingFiles[progress.index];
            if (!entry) return;
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === entry.id ? { ...f, progress: progress.percent } : f))
            );
          });
          onChange([...valueRef.current, ...uploaded]);

          // Hold the chips at 100% briefly so the user sees the check before
          // they fade out into the freshly added thumbnails.
          newUploadingFiles.forEach((entry) => {
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === entry.id ? { ...f, progress: 100 } : f))
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
      setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
    };

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
            <motion.div
              key={uploadingFile.id}
              layout
              className="overflow-hidden"
              {...chipMotion}
            >
              <div className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg border border-border/40">
                <div className="flex-shrink-0 w-8 h-8 rounded-md bg-background border border-border/60 flex items-center justify-center text-muted-foreground">
                  {iconFor(uploadingFile.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{uploadingFile.name}</p>
                  <div className="w-full bg-muted rounded-full h-1 mt-1.5 overflow-hidden">
                    <motion.div
                      className="bg-primary h-1 rounded-full"
                      animate={{ width: `${uploadingFile.progress}%` }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  </div>
                </div>
                <div className="flex-shrink-0 text-xs text-muted-foreground font-mono tabular-nums">
                  {uploadingFile.progress >= 100 ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    `${uploadingFile.progress}%`
                  )}
                </div>
                <button
                  onClick={() => removeUploadingFile(uploadingFile.id)}
                  className="flex-shrink-0 p-1 hover:bg-muted rounded-md transition-colors"
                  aria-label="Отменить загрузку"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Уже загруженные файлы */}
        {value.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {value.map((attachment, index) => (
                <motion.div key={`${attachment.url}-${index}`} layout className="relative" {...thumbMotion}>
                  {attachment.type === "image" ? (
                    <div className="group relative h-20 w-20 sm:h-24 sm:w-24 rounded-lg overflow-hidden border border-border/60 bg-muted/20">
                      <img
                        src={attachmentSrc(bucket, attachment)}
                        alt={attachment.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <button
                        onClick={() => handleRemove(index)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity hover:bg-black/80"
                        aria-label="Удалить"
                      >
                        <X className="w-3 h-3" />
                      </button>
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

    if (!dropZone) {
      return renderContent(false);
    }
    return (
      <FileDropZone onFiles={processFiles} disabled={uploading}>
        {renderContent}
      </FileDropZone>
    );
  }
);
