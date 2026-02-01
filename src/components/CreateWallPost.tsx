import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, X, Save, Loader2 } from "lucide-react";
import { imageProcessing } from "@/lib/imageProcessing";

interface WallPost {
  id: string;
  user_id: string;
  author_id: string;
  title: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  author: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  };
}

interface CreateWallPostProps {
  profileUserId: string;
  currentUserId: string;
  editingPost?: WallPost;
  onPostCreated?: (post: WallPost) => void;
  onPostUpdated?: (post: WallPost) => void;
  onCancel: () => void;
}

export const CreateWallPost: React.FC<CreateWallPostProps> = ({
  profileUserId,
  currentUserId,
  editingPost,
  onPostCreated,
  onPostUpdated,
  onCancel
}) => {
  const [title, setTitle] = useState(editingPost?.title || "");
  const [content, setContent] = useState(editingPost?.content || "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(editingPost?.image_url || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!editingPost;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error("Пожалуйста, выберите изображение");
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Изображение слишком большое. Максимальный размер: 5MB");
      return;
    }

    try {
      // Process image for privacy (remove metadata)
      const processedImage = await imageProcessing.processImage(file);
      setImageFile(processedImage);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(processedImage);
    } catch (error) {
      console.error("Error processing image:", error);
      toast.error("Ошибка обработки изображения");
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadImage = async (file: File): Promise<string> => {
    const fileName = `${profileUserId}/wall_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('post-images')
      .upload(fileName, file);

    if (uploadError) {
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('post-images')
      .getPublicUrl(fileName);

    return publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("Заголовок обязателен");
      return;
    }

    setIsSubmitting(true);

    try {
      let imageUrl = editingPost?.image_url || null;

      // Upload new image if selected
      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
      }

      const postData = {
        user_id: profileUserId,
        author_id: currentUserId,
        title: title.trim(),
        content: content.trim() || null,
        image_url: imageUrl,
      };

      if (isEditing) {
        // Update existing post
        const { data, error } = await supabase
          .from("profile_wall_posts")
          .update({
            title: postData.title,
            content: postData.content,
            image_url: postData.image_url,
          })
          .eq("id", editingPost.id)
          .eq("author_id", currentUserId) // Ensure user can only edit their own posts
          .select(`
            id,
            user_id,
            author_id,
            title,
            content,
            image_url,
            created_at,
            updated_at,
            author:profiles!author_id (
              username,
              is_anonymous,
              avatar_url
            )
          `)
          .single();

        if (error) throw error;

        onPostUpdated?.(data);
        toast.success("Пост обновлен");
      } else {
        // Create new post
        const { data, error } = await supabase
          .from("profile_wall_posts")
          .insert([postData])
          .select(`
            id,
            user_id,
            author_id,
            title,
            content,
            image_url,
            created_at,
            updated_at,
            author:profiles!author_id (
              username,
              is_anonymous,
              avatar_url
            )
          `)
          .single();

        if (error) throw error;

        onPostCreated?.(data);
        toast.success("Пост опубликован");
      }
    } catch (error) {
      console.error("Error saving post:", error);
      toast.error(isEditing ? "Ошибка обновления поста" : "Ошибка публикации поста");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Заголовок *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Введите заголовок поста..."
              maxLength={100}
              required
            />
          </div>

          <div>
            <Label htmlFor="content">Текст поста</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Напишите что-нибудь..."
              rows={4}
              maxLength={2000}
            />
          </div>

          <div>
            <Label>Изображение</Label>
            <div className="mt-2">
              {imagePreview ? (
                <div className="relative inline-block">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="max-w-xs max-h-48 rounded-lg border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={removeImage}
                    className="absolute -top-2 -right-2 h-6 w-6 p-0"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Выбрать изображение
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEditing ? "Сохранение..." : "Публикация..."}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {isEditing ? "Сохранить" : "Опубликовать"}
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Отмена
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};