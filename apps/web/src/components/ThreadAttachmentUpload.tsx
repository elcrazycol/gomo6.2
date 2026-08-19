import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AttachmentMeta } from "@/utils/mediaUpload";
import { uploadAttachments } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";
import { FileDropZone } from "@/components/FileDropZone";
import { UploadProgressChip, type UploadingFileLike } from "@/components/UploadProgressChip";
import { chipMotion } from "@/components/uploadMotions";

interface ThreadAttachmentUploadProps {
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

export const ThreadAttachmentUpload = ({ value, onChange, maxFiles = 8 }: ThreadAttachmentUploadProps) => {
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
      return;
    }
    inputRef.current?.click();
  };

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (valueRef.current.length + files.length > maxFiles) return;

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
        toast.error(error instanceof Error ? error.message : "Не удалось загрузить файлы");
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
    await processFiles(files);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const removeUploadingFile = (id: string) => {
    cancelledRef.current.add(id);
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <FileDropZone onFiles={processFiles} disabled={uploading}>
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
            className={`h-8 w-8 sm:h-10 sm:w-10 rounded-xl border flex items-center justify-center transition-colors disabled:opacity-50 ${
              isDragging
                ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/40"
                : "border-border/50 bg-background/80 backdrop-blur-sm hover:bg-muted/50"
            }`}
            aria-label="Добавить файл"
          >
            {uploading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Upload className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>

          {/* Прогресс загрузки */}
          <AnimatePresence initial={false}>
            {uploadingFiles.map((uploadingFile) => (
              <motion.div key={uploadingFile.id} layout className="overflow-hidden" {...chipMotion}>
                <UploadProgressChip file={uploadingFile} onCancel={removeUploadingFile} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </FileDropZone>
  );
};
