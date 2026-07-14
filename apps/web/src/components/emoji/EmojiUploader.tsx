import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, Loader2, AlertCircle } from 'lucide-react';
import { processEmojiImage, validateEmojiFile, CompressionResult } from '@/utils/emojiCompression';

interface EmojiUploaderProps {
  onUpload: (result: CompressionResult & { file: File }) => void;
  disabled?: boolean;
}

export function EmojiUploader({ onUpload, disabled }: EmojiUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setPreview(null);

    const validation = validateEmojiFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }

    setProcessing(true);
    try {
      const result = await processEmojiImage(file);
      const previewUrl = URL.createObjectURL(result.file);
      setPreview(previewUrl);
      onUpload({ ...result, file: result.file });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setProcessing(false);
    }
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }, [handleFile]);

  return (
    <div className="space-y-2">
      <div
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handleChange}
          disabled={disabled || processing}
        />

        {processing ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Обработка...</span>
          </div>
        ) : preview ? (
          <div className="flex items-center justify-center gap-3">
            <img src={preview} alt="Preview" className="w-12 h-12 object-contain" />
            <span className="text-sm text-muted-foreground">Нажмите или перетащите для замены</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <Upload className="h-6 w-6" />
            <span className="text-sm">Перетащите PNG, JPG, WebP или GIF</span>
            <span className="text-xs">Статика: до 3KB, Анимация: до 15KB</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1 text-destructive text-xs">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}
