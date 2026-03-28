import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, FileAudio2, FileVideo2, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AttachmentMeta, uploadAttachments } from "@/utils/mediaUpload";

interface AttachmentUploadProps {
  value: AttachmentMeta[];
  onChange: (attachments: AttachmentMeta[]) => void;
  maxFiles?: number;
}

const ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-rar-compressed",
  "application/octet-stream",
];

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} КБ`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} МБ`;
};

const iconFor = (type: AttachmentMeta["type"]) => {
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

export const AttachmentUpload = ({ value, onChange, maxFiles = 6 }: AttachmentUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleSelect = () => {
    if (value.length >= maxFiles) {
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }
    inputRef.current?.click();
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (value.length + files.length > maxFiles) {
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }

    setUploading(true);
    try {
      const uploaded = await uploadAttachments(files);
      const updated = [...value, ...uploaded];
      onChange(updated);
      toast.success(`Загружено ${uploaded.length} файлов`);
    } catch (error: any) {
      console.error("Attachment upload error", error);
      if (error?.message) toast.error(error.message);
      else toast.error("Не удалось загрузить файлы");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemove = (index: number) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        multiple
        className="hidden"
        onChange={handleFiles}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleSelect}
        disabled={uploading}
        aria-label="Добавить файл"
        className="h-9 w-9"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        <span className="sr-only">Добавить файл</span>
      </Button>
    </div>
  );
};
