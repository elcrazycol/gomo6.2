import { useRef, useState, useEffect } from "react";
import { Upload, Loader2, FileAudio2, FileVideo2, FileText, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { AttachmentMeta } from "@/types/forum";
import { uploadAttachments } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";
import { AudioAttachment } from "@/components/AudioAttachment";

interface AttachmentUploadProps {
  value: AttachmentMeta[];
  onChange: (attachments: AttachmentMeta[]) => void;
  maxFiles?: number;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  name: string;
  type: string;
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

export const AttachmentUpload = ({ value, onChange, maxFiles = 6 }: AttachmentUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  useEffect(() => {
    clearMediaCache();
  }, []);

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

    await processFiles(files);
  };

  const processFiles = async (files: File[]) => {
    setUploading(true);
    
    const newUploadingFiles: UploadingFile[] = files.map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      progress: 0,
      name: file.name,
      type: file.type.startsWith('image/') ? 'image' : 
            file.type.startsWith('video/') ? 'video' : 
            file.type.startsWith('audio/') ? 'audio' : 'file'
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
      }, 1000);
      
    } catch (error: any) {
      console.error("Attachment upload error", error);
      toast.error("Не удалось загрузить файлы");
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
    <div className="space-y-2">
      {/* Простая кнопка */}
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
        className="h-9 w-9 rounded-md border border-border/70 bg-background hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-50"
        aria-label="Добавить файл"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
      </button>
      
      {/* Загружаемые файлы */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-1">
          {uploadingFiles.map(uploadingFile => (
            <div key={uploadingFile.id} className="flex items-center gap-2 p-1.5 bg-muted/30 rounded-md">
              <div className="flex-shrink-0">
                {iconFor(uploadingFile.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{uploadingFile.name}</p>
                <div className="w-full bg-muted rounded-full h-1 mt-0.5">
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
                className="flex-shrink-0 p-0.5 hover:bg-muted rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      
      {/* Загруженные файлы */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((att, idx) => (
            <div key={att.url} className="relative group">
              {att.type === 'image' ? (
                <div className="aspect-video border rounded-md overflow-hidden bg-muted/40 max-w-xs">
                  <img 
                    src={att.url} 
                    alt={att.name || ''}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : att.type === 'audio' ? (
                <AudioAttachment 
                  attachment={att}
                  showPlayer={false}
                  className="max-w-xs"
                />
              ) : att.type === 'video' ? (
                <div className="aspect-video border rounded-md overflow-hidden bg-muted/40 max-w-xs">
                  {att.poster ? (
                    <img 
                      src={att.poster} 
                      alt={att.name || ''}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileVideo2 className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="border border-border bg-card rounded-lg p-3 max-w-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                      {iconFor(att.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{att.name || ''}</p>
                      <p className="text-muted-foreground text-xs">
                        {att.size ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <button
                onClick={() => handleRemove(idx)}
                className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
