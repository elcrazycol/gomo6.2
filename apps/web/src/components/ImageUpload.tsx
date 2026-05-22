import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { compressImageWithMetadataRemoval, getUserPrivacySettings } from "@/lib/imageProcessing";

interface ImageUploadProps {
  images?: string[];
  onImagesChange?: (images: string[]) => void;
  maxImages?: number;
  onImagesUploaded: (urls: string[]) => void;
  currentImages?: string[];
  maxImages?: number;
  triggerMode?: "button" | "zone";
  triggerText?: string;
}

export const ImageUpload = ({
  onImagesUploaded,
  currentImages = [],
  maxImages = 10,
  triggerMode = "button",
  triggerText,
}: ImageUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [previews, setPreviews] = useState<string[]>(currentImages);
  const [removeMetadata, setRemoveMetadata] = useState(true);

  useEffect(() => {
    setPreviews(currentImages);
  }, [currentImages]);

  // Load user's privacy settings on component mount
  useEffect(() => {
    const loadPrivacySettings = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const settings = await getUserPrivacySettings(user.id);
        setRemoveMetadata(settings.remove_image_metadata);
      }
    };

    loadPrivacySettings();
  }, []);

  // Compress image function with metadata removal based on user settings
  const compressImage = async (file: File, maxWidth: number = 1200, quality: number = 0.8): Promise<File> => {
    try {
      return await compressImageWithMetadataRemoval(file, maxWidth, quality, removeMetadata);
    } catch (error) {
      console.warn('Advanced compression failed, falling back to basic compression:', error);
      // Fallback to basic compression if advanced fails
      return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: file.type,
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Failed to compress image'));
            }
          }, file.type, quality);
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (previews.length + files.length > maxImages) {
      toast.error(`Максимум ${maxImages} изображений`);
      return;
    }

    // Validate file types
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

      // Compress images before upload
      const compressionPromises = files.map(async (file) => {
        try {
          return await compressImage(file);
        } catch (error) {
          console.warn('Compression failed, using original file:', error);
          return file;
        }
      });

      const compressedFiles = await Promise.all(compressionPromises);

      const uploadPromises = compressedFiles.map(async (file) => {
        const fileExt = file.name.split('.').pop() || 'jpg';
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 9);
        const fileName = `${user.id}/${timestamp}_${randomStr}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('content')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(uploadError.message || 'Ошибка загрузки файла');
        }

        // Store storageKey in DB; UI previews are rendered via storageUrl().
        return fileName;
      });

      const newUrls = await Promise.all(uploadPromises);
      const updatedPreviews = [...previews, ...newUrls];
      setPreviews(updatedPreviews);
      onImagesUploaded(updatedPreviews);
      toast.success(`Загружено ${newUrls.length} изображений`);
    } catch (error: any) {
      console.error('Image upload error:', error);
      toast.error(error.message || "Ошибка загрузки изображений. Проверьте настройки storage в Supabase.");
    } finally {
      setUploading(false);
      // Reset input
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handleRemove = (index: number) => {
    const updatedPreviews = previews.filter((_, i) => i !== index);
    setPreviews(updatedPreviews);
    onImagesUploaded(updatedPreviews);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    if (previews.length >= maxImages) {
      toast.error(`Максимум ${maxImages} изображений`);
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          disabled={uploading || previews.length >= maxImages}
          multiple
          className="hidden"
        />
        {triggerMode === "zone" ? (
          <button
            type="button"
            disabled={uploading || previews.length >= maxImages}
            onClick={handleButtonClick}
            className="w-full rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {triggerText ||
              (uploading
                ? "Загрузка..."
                : previews.length === 0
                ? "Нажми, чтобы добавить фото"
                : `Нажми, чтобы добавить фото (${previews.length}/${maxImages})`)}
          </button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || previews.length >= maxImages}
            onClick={handleButtonClick}
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Загрузка..." : previews.length === 0 ? "Загрузить фото" : `Добавить фото (${previews.length}/${maxImages})`}
          </Button>
        )}
      </div>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((preview, index) => (
            <div key={index} className="relative inline-block">
              <img
                src={storageUrl("content", preview) || preview}
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
    </div>
  );
};
