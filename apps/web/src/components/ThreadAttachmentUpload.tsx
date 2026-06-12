import { useRef, useState, useEffect } from "react";
import { Upload, Loader2, X } from "lucide-react";
import { AttachmentMeta } from "@/utils/mediaUpload";
import { uploadAttachments } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";

interface ThreadAttachmentUploadProps {
  value: AttachmentMeta[];
  onChange: (attachments: AttachmentMeta[]) => void;
  maxFiles?: number;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  name: string;
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
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  useEffect(() => {
    clearMediaCache();
  }, []);

  const handleSelect = () => {
    if (value.length >= maxFiles) {
      return;
    }
    inputRef.current?.click();
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (value.length + files.length > maxFiles) {
      return;
    }

    await processFiles(files);
  };

  const processFiles = async (files: File[]) => {
    setUploading(true);
    
    const newUploadingFiles: UploadingFile[] = files.map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      progress: 0,
      name: file.name
    }));
    
    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);
    
    try {
      for (const uploadingFile of newUploadingFiles) {
        for (let progress = 10; progress <= 90; progress += 10) {
          setUploadingFiles(prev => 
            prev.map(f => f.id === uploadingFile.id ? { ...f, progress } : f)
          );
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      const uploaded = await uploadAttachments(files);
      const updated = [...value, ...uploaded];
      onChange(updated);
      
      newUploadingFiles.forEach(uploadingFile => {
        setUploadingFiles(prev => 
          prev.map(f => f.id === uploadingFile.id ? { ...f, progress: 100 } : f)
        );
      });
      
      setTimeout(() => {
        setUploadingFiles(prev => prev.filter(f => !newUploadingFiles.find(nf => nf.id === f.id)));
      }, 800);
      
    } catch (error: unknown) {
      console.error("Attachment upload error", error);
      setUploadingFiles(prev => prev.filter(f => !newUploadingFiles.find(nf => nf.id === f.id)));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (index: number) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  const removeUploadingFile = (id: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== id));
  };

  return (
    <>
      {/* Компактная кнопка */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        multiple
        className="hidden"
        onChange={handleFiles}
      />
      <button
        type="button"
        onClick={handleSelect}
        disabled={uploading}
        className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm hover:bg-muted/50 flex items-center justify-center transition-colors disabled:opacity-50"
        aria-label="Добавить файл"
      >
        {uploading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : <Upload className="w-4 h-4 sm:w-5 sm:h-5" />}
      </button>
      
      {/* Прогресс загрузки - отдельная панель */}
      {uploadingFiles.length > 0 && (
        <div className="absolute top-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-b border-border/50 z-10 p-2">
          <div className="max-w-4xl mx-auto space-y-1">
            {uploadingFiles.map(uploadingFile => (
              <div key={uploadingFile.id} className="flex items-center gap-2">
                <div className="w-4 h-4 bg-primary/20 rounded flex items-center justify-center flex-shrink-0">
                  <Upload className="w-2 h-2" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{uploadingFile.name}</p>
                  <div className="w-full bg-muted/60 rounded-full h-1 mt-0.5">
                    <div 
                      className="bg-primary h-1 rounded-full transition-all duration-300"
                      style={{ width: `${uploadingFile.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex-shrink-0 text-xs text-muted-foreground font-mono">
                  {uploadingFile.progress}%
                </div>
                <button
                  onClick={() => removeUploadingFile(uploadingFile.id)}
                  className="flex-shrink-0 p-0.5 hover:bg-muted/40 rounded transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
