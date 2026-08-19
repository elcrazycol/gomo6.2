import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Upload, Loader2, FileAudio2, FileText, FileVideo2, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import type { AttachmentMeta } from "@/types/forum";
import { uploadAttachments } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";
import { AudioAttachment } from "@/components/AudioAttachment";
import { FileDropZone } from "@/components/FileDropZone";
import { UploadProgressChip, type UploadingFileLike } from "@/components/UploadProgressChip";
import { chipMotion, itemMotion } from "@/components/uploadMotions";

interface AttachmentUploadProps {
  value: AttachmentMeta[];
  onChange: (attachments: AttachmentMeta[]) => void;
  maxFiles?: number;
}

const ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

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

const formatSize = (bytes?: number): string => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const AttachmentUpload = ({ value, onChange, maxFiles = 6 }: AttachmentUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFileLike[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const holdTimersRef = useRef<number[]>([]);
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
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }
    inputRef.current?.click();
  };

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (valueRef.current.length + files.length > maxFiles) {
        toast.error(`Максимум ${maxFiles} файлов`);
        return;
      }

      setUploading(true);
      const newUploadingFiles: UploadingFileLike[] = files.map((file) => ({
        id: Math.random().toString(36).slice(2, 11),
        file,
        progress: 0,
        name: file.name,
        type: file.type.startsWith("image/") ? "image"
          : file.type.startsWith("video/") ? "video"
          : file.type.startsWith("audio/") ? "audio"
          : "file",
        phase: "upload",
      }));

      setUploadingFiles((prev) => [...prev, ...newUploadingFiles]);

      try {
        const uploaded = await uploadAttachments(files, "content", (progress) => {
          const entry = newUploadingFiles[progress.index];
          if (!entry || cancelledRef.current.has(entry.id)) return;
          setUploadingFiles((prev) =>
            prev.map((f) => (f.id === entry.id ? { ...f, progress: progress.percent, phase: progress.phase } : f))
          );
        });
        const kept = uploaded.filter((_, i) => !cancelledRef.current.has(newUploadingFiles[i]?.id));
        if (kept.length > 0) {
          onChange([...valueRef.current, ...kept]);
        }

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
      } catch (error: unknown) {
        console.error("Attachment upload error", error);
        toast.error("Не удалось загрузить файлы");
        setUploadingFiles((prev) => prev.filter((f) => !newUploadingFiles.some((nf) => nf.id === f.id)));
      } finally {
        setUploading(false);
      }
    },
    [maxFiles, onChange]
  );

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (value.length + files.length > maxFiles) {
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }
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

  const renderItem = (att: AttachmentMeta, idx: number) => {
    if (att.type === "image") {
      return (
        <div className="aspect-video border rounded-md overflow-hidden bg-muted/40 max-w-xs">
          <img src={att.url} alt={att.name || ""} className="w-full h-full object-cover" />
        </div>
      );
    }
    if (att.type === "audio") {
      return (
        <AudioAttachment attachment={att} showPlayer={false} className="max-w-xs" />
      );
    }
    if (att.type === "video") {
      return (
        <div className="aspect-video border rounded-md overflow-hidden bg-muted/40 max-w-xs">
          {att.poster ? (
            <img src={att.poster} alt={att.name || ""} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileVideo2 className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="border border-border bg-card rounded-lg p-3 max-w-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
            {iconFor(att.type)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{att.name || ""}</p>
            <p className="text-muted-foreground text-xs">{formatSize(att.size)}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <FileDropZone
      onFiles={(files) => {
        if (value.length + files.length > maxFiles) {
          toast.error(`Максимум ${maxFiles} файлов`);
          return;
        }
        void processFiles(files);
      }}
      disabled={uploading}
    >
      {(isDragging) => (
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT.join(",")}
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

          {/* Загруженные файлы */}
          {value.length > 0 && (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {value.map((att, idx) => (
                  <motion.div key={`${att.url}-${idx}`} layout className="relative group" {...itemMotion}>
                    {renderItem(att, idx)}
                    <button
                      type="button"
                      onClick={() => handleRemove(idx)}
                      className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </FileDropZone>
  );
};
