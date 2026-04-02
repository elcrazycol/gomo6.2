import { useRef, useState, useEffect } from "react";
import { Upload, Loader2, FileAudio2, FileVideo2, FileText, Image as ImageIcon, X } from "lucide-react";
import { AttachmentMeta } from "@/types/forum";
import { uploadAttachments } from "@/utils/mediaUpload";
import { clearMediaCache } from "@/utils/mediaCache";

interface ProfileAttachmentUploadProps {
  value: AttachmentMeta[];
  onChange: (attachments: AttachmentMeta[]) => void;
  maxFiles?: number;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  name: string;
  type: 'image' | 'video' | 'audio' | 'file';
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

export const ProfileAttachmentUpload = ({ value, onChange, maxFiles = 6 }: ProfileAttachmentUploadProps) => {
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

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    
    if (value.length + files.length > maxFiles) {
      return;
    }
    
    setUploading(true);
    const newUploadingFiles: UploadingFile[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      name: file.name,
      type: file.type.startsWith('image/') ? 'image' : 
            file.type.startsWith('video/') ? 'video' : 
            file.type.startsWith('audio/') ? 'audio' : 'file'
    }));
    
    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);
    
    try {
      // Имитация прогресса
      for (let progress = 10; progress <= 90; progress += 10) {
        newUploadingFiles.forEach(uploadingFile => {
          setUploadingFiles(prev => 
            prev.map(f => f.id === uploadingFile.id ? { ...f, progress } : f)
          );
        });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const uploaded = await uploadAttachments(files);
      const updated = [...value, ...uploaded];
      onChange(updated);
      
      // Завершаем прогресс
      newUploadingFiles.forEach(uploadingFile => {
        setUploadingFiles(prev => 
          prev.map(f => f.id === uploadingFile.id ? { ...f, progress: 100 } : f)
        );
      });
      
      // Убираем файлы из состояния загрузки через секунду
      setTimeout(() => {
        setUploadingFiles(prev => prev.filter(f => !newUploadingFiles.find(nf => nf.id === f.id)));
      }, 1000);
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadingFiles(prev => prev.filter(f => !newUploadingFiles.find(nf => nf.id === f.id)));
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
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
    <div className="space-y-3">
      {/* Компактная кнопка */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx"
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
        <div className="space-y-2">
          {uploadingFiles.map(uploadingFile => (
            <div key={uploadingFile.id} className="flex items-center gap-2 p-2 bg-muted/20 rounded-lg">
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
      
      {/* Уже загруженные файлы */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((attachment, index) => (
            <div key={index} className="flex items-center gap-2 p-2 bg-muted/10 rounded-lg border border-border/30">
              <div className="flex-shrink-0">
                {iconFor(attachment.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{attachment.name}</p>
                <p className="text-xs text-muted-foreground">
                  {attachment.type} • {(attachment.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={() => handleRemove(index)}
                className="flex-shrink-0 p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
