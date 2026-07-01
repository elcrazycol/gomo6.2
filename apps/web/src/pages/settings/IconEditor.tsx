import { useState, useRef, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { convertImageToSvg, type ImageToSvgResult } from "@/utils/imageToSvg";
import { Upload, Image as ImageIcon, X, FileCode } from "lucide-react";
import { toast } from "sonner";

interface IconEditorProps {
  svg: string;
  fill: string;
  stroke: string;
  onSvgChange: (svg: string) => void;
  onFillChange: (fill: string) => void;
  onStrokeChange: (stroke: string) => void;
}

export function IconEditor({ svg, fill, stroke, onSvgChange, onFillChange, onStrokeChange }: IconEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [lastConversion, setLastConversion] = useState<ImageToSvgResult | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) return;

      // Validate file type
      const validTypes = [
        "image/svg+xml", "image/png", "image/jpeg", "image/gif",
        "image/webp", "image/bmp", "image/avif",
      ];
      const isValid =
        validTypes.includes(file.type) ||
        /\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);

      if (!isValid) {
        toast.error("Поддерживаются только изображения (PNG, JPG, SVG, GIF, WebP, BMP)");
        return;
      }

      // 2 MB limit
      if (file.size > 2 * 1024 * 1024) {
        toast.error("Файл слишком большой (макс 2 МБ)");
        return;
      }

      setConverting(true);
      try {
        const result = await convertImageToSvg(file);
        setLastConversion(result);
        onSvgChange(result.svg);
        toast.success(
          result.wasVector
            ? "SVG загружен"
            : `Изображение ${result.originalWidth}×${result.originalHeight} конвертировано в SVG`,
        );
      } catch (err) {
        console.error("Image conversion error:", err);
        toast.error("Ошибка конвертации изображения");
      } finally {
        setConverting(false);
      }
    },
    [onSvgChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const clearIcon = () => {
    onSvgChange("");
    setLastConversion(null);
  };

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-2 p-6
          border-2 border-dashed rounded-xl cursor-pointer transition-all
          ${isDragging
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/40 hover:bg-muted/30"
          }
          ${converting ? "opacity-60 pointer-events-none" : ""}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.svg"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
          className="hidden"
        />

        {converting ? (
          <>
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Конвертация...</span>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Перетащите изображение или нажмите для загрузки
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                PNG, JPG, GIF, WebP, SVG — любой формат, до 2 МБ
              </p>
              <p className="text-xs text-muted-foreground">
                Изображение автоматически конвертируется в SVG-код на вашем устройстве
              </p>
            </div>
          </>
        )}
      </div>

      {/* Conversion info */}
      {lastConversion && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
          {lastConversion.wasVector ? (
            <FileCode className="w-4 h-4 shrink-0" />
          ) : (
            <ImageIcon className="w-4 h-4 shrink-0" />
          )}
          <span>
            {lastConversion.wasVector
              ? "Векторный SVG загружен"
              : `Растр ${lastConversion.originalWidth}×${lastConversion.originalHeight} → SVG (data URI)`}
          </span>
        </div>
      )}

      {/* Current SVG preview */}
      {svg && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
          <div
            className="w-10 h-10 flex items-center justify-center bg-background rounded border border-border"
            dangerouslySetInnerHTML={{ __html: svg }}
            style={{ fill, stroke }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-bold"
                style={{ color: "var(--foreground)" }}
              >
                username
              </span>
              <div
                className="w-5 h-5 inline-flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: svg }}
                style={{ fill, stroke }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              {svg.length > 80 ? svg.slice(0, 80) + "..." : svg}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={clearIcon} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* SVG code textarea */}
      <div>
        <Label className="text-sm font-medium mb-2 block">SVG код</Label>
        <Textarea
          value={svg}
          onChange={(e) => onSvgChange(e.target.value)}
          placeholder='<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>'
          rows={4}
          className="font-mono text-xs resize-y"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          SVG код можно вставить вручную или загрузить изображение выше
        </p>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium mb-2 block">Fill (заливка)</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="color"
              value={fill}
              onChange={(e) => onFillChange(e.target.value)}
              className="w-14 h-10 p-1 cursor-pointer"
            />
            <Input
              type="text"
              value={fill}
              onChange={(e) => onFillChange(e.target.value)}
              className="flex-1 font-mono text-sm"
            />
          </div>
        </div>
        <div>
          <Label className="text-sm font-medium mb-2 block">Stroke (обводка)</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="color"
              value={stroke}
              onChange={(e) => onStrokeChange(e.target.value)}
              className="w-14 h-10 p-1 cursor-pointer"
            />
            <Input
              type="text"
              value={stroke}
              onChange={(e) => onStrokeChange(e.target.value)}
              className="flex-1 font-mono text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
