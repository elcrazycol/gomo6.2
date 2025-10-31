import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

interface ImageUploadProps {
  onImageUploaded: (url: string) => void;
  currentImage?: string | null;
  onRemove?: () => void;
}

export const ImageUpload = ({ onImageUploaded, currentImage, onRemove }: ImageUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentImage || null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      toast.error("Неподдерживаемый формат. Используйте JPG, PNG, WEBP или GIF");
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10485760) {
      toast.error("Файл слишком большой. Максимум 10MB");
      return;
    }

    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Нужно войти для загрузки изображений");
        return;
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Math.random()}.${fileExt}`;

      const { error: uploadError, data } = await supabase.storage
        .from('post-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('post-images')
        .getPublicUrl(fileName);

      setPreview(publicUrl);
      onImageUploaded(publicUrl);
      toast.success("Изображение загружено");
    } catch (error: any) {
      toast.error("Ошибка загрузки изображения");
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    if (onRemove) onRemove();
  };

  return (
    <div className="space-y-2">
      {preview ? (
        <div className="relative inline-block">
          <img src={preview} alt="Preview" className="max-w-xs max-h-48 border border-border" />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="absolute top-1 right-1"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
          <Button type="button" variant="outline" disabled={uploading} asChild>
            <span>
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? "Загрузка..." : "Загрузить изображение"}
            </span>
          </Button>
        </label>
      )}
    </div>
  );
};
