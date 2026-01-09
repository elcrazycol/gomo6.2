import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

interface ImageUploadProps {
  onImagesUploaded: (urls: string[]) => void;
  currentImages?: string[];
  maxImages?: number;
}

export const ImageUpload = ({ onImagesUploaded, currentImages = [], maxImages = 10 }: ImageUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [previews, setPreviews] = useState<string[]>(currentImages);

  useEffect(() => {
    setPreviews(currentImages);
  }, [currentImages]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (previews.length + files.length > maxImages) {
      toast.error(`Максимум ${maxImages} изображений`);
      return;
    }

    // Validate file types and sizes
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    for (const file of files) {
      if (!validTypes.includes(file.type)) {
        toast.error("Неподдерживаемый формат. Используйте JPG, PNG, WEBP или GIF");
        return;
      }
      if (file.size > 10485760) {
        toast.error("Файл слишком большой. Максимум 10MB");
        return;
      }
    }

    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Нужно войти для загрузки изображений");
        return;
      }

      const uploadPromises = files.map(async (file) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${user.id}/${Math.random()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('post-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('post-images')
          .getPublicUrl(fileName);

        return publicUrl;
      });

      const newUrls = await Promise.all(uploadPromises);
      const updatedPreviews = [...previews, ...newUrls];
      setPreviews(updatedPreviews);
      onImagesUploaded(updatedPreviews);
      toast.success(`Загружено ${newUrls.length} изображений`);
    } catch (error: any) {
      toast.error("Ошибка загрузки изображений");
      console.error(error);
    } finally {
      setUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleRemove = (index: number) => {
    const updatedPreviews = previews.filter((_, i) => i !== index);
    setPreviews(updatedPreviews);
    onImagesUploaded(updatedPreviews);
  };

  return (
    <div className="space-y-2">
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((preview, index) => (
            <div key={index} className="relative inline-block">
              <img
                src={preview}
                alt={`Preview ${index + 1}`}
                className="max-w-xs max-h-48 border border-border rounded"
              />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="absolute top-1 right-1"
                onClick={() => handleRemove(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {previews.length < maxImages && (
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            disabled={uploading}
            multiple
            className="hidden"
          />
          <Button type="button" variant="outline" disabled={uploading} asChild>
            <span>
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? "Загрузка..." : `Загрузить изображения (${previews.length}/${maxImages})`}
            </span>
          </Button>
        </label>
      )}
    </div>
  );
};
