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
          relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200
          ${isDragOver
            ? 'border-primary bg-primary/5'
            : currentFile
              ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
              : 'border-border hover:border-primary/50 hover:bg-muted/50'
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
          <div className="space-y-3">
            <div className="flex items-center justify-center space-x-2">
              <ImageIcon className="h-8 w-8 text-green-500" />
              <div className="text-left">
                <p className="font-medium text-sm">{currentFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(currentFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              className="absolute top-2 right-2 h-6 w-6 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload className={`h-10 w-10 mx-auto ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <div>
              <p className="font-medium text-sm">
                {isDragOver ? 'Отпустите файл здесь' : 'Перетащите файл сюда или нажмите'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PNG, JPG, GIF до {maxSize}MB
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};