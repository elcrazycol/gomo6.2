import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  currentFile?: File | null;
  onRemove?: () => void;
  accept?: string;
  maxSize?: number; // in MB
  className?: string;
}

export const FileUpload = ({
  onFileSelect,
  currentFile,
  onRemove,
  accept = "image/*",
  maxSize = 10,
  className = ""
}: FileUploadProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = (file: File) => {
    // Check file type
    if (!file.type.startsWith('image/')) {
      toast.error('Пожалуйста, выберите изображение');
      return;
    }

    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      toast.error(`Файл слишком большой. Максимальный размер: ${maxSize}MB`);
      return;
    }

    onFileSelect(file);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onRemove?.();
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl text-center cursor-pointer transition-all duration-200
          flex items-center justify-center
          h-[80px] w-80 bg-background hover:bg-muted/30
          ${isDragOver
            ? 'border-primary bg-primary/10 scale-[1.02]'
            : currentFile
              ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
              : 'border-border/60 hover:border-primary/40'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileInput}
          className="hidden"
        />

        {currentFile ? (
          <div className="flex items-center justify-center gap-2">
            <ImageIcon className="h-6 w-6 text-green-500 flex-shrink-0" />
            <div className="text-left">
              <p className="font-medium text-sm truncate max-w-[200px]">{currentFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(currentFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              className="h-6 w-6 p-0 flex-shrink-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Upload className={`h-5 w-5 flex-shrink-0 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="text-sm text-muted-foreground text-center">
              {isDragOver ? 'Отпустите файл здесь' : 'Перетащите или нажмите для загрузки'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};