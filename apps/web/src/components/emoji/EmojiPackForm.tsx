import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '@/integrations/api/compat';
import { uploadFile } from '@/utils/storage';
import { EmojiUploader } from './EmojiUploader';
import { CompressionResult } from '@/utils/emojiCompression';
import { storageUrl } from '@/utils/storage';

interface EmojiPackFormProps {
  initialData?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon_url: string | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function EmojiPackForm({ initialData, onSuccess, onCancel }: EmojiPackFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [slug, setSlug] = useState(initialData?.slug || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(
    initialData?.icon_url ? storageUrl('emojis', initialData.icon_url) : null
  );
  const [saving, setSaving] = useState(false);
  const [isSlugManual, setIsSlugManual] = useState(false);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!isSlugManual) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(slugify(value));
    setIsSlugManual(true);
  };

  const handleIconUpload = (result: CompressionResult & { file: File }) => {
    setIconFile(result.file);
    setIconPreview(URL.createObjectURL(result.file));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Введите название пака');
      return;
    }
    if (!slug.trim()) {
      toast.error('Введите slug');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        toast.error('Необходима авторизация');
        return;
      }

      let iconUrl = initialData?.icon_url || null;

      if (iconFile) {
        const ext = iconFile.name.split('.').pop() || 'webp';
        const key = `${user.id}/${slug}/_icon.${ext}`;
        await uploadFile('emojis', key, iconFile);
        iconUrl = key;
      }

      const packData = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        icon_url: iconUrl,
        author_id: user.id,
        updated_at: new Date().toISOString(),
      };

      if (initialData) {
        const { error } = await api
          .from('emoji_packs')
          .update(packData)
          .eq('id', initialData.id);

        if (error) throw error;
        toast.success('Пак обновлён');
      } else {
        const { error } = await api
          .from('emoji_packs')
          .insert({ ...packData, created_at: new Date().toISOString() });

        if (error) throw error;
        toast.success('Пак создан');
      }

      onSuccess();
    } catch (err) {
      console.error('Error saving pack:', err);
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pack-name">Название</Label>
        <Input
          id="pack-name"
          placeholder="Мой пак эмодзи"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={saving}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pack-slug">Slug (для URL)</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">/emojis/pack/</span>
          <Input
            id="pack-slug"
            placeholder="my-emoji-pack"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            disabled={saving}
            className="flex-1"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pack-desc">Описание (необязательно)</Label>
        <Input
          id="pack-desc"
          placeholder="Описание пака..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
        />
      </div>

      <div className="space-y-2">
        <Label>Иконка пака (необязательно)</Label>
        <EmojiUploader onUpload={handleIconUpload} disabled={saving} />
        {iconPreview && (
          <div className="flex justify-center">
            <img src={iconPreview} alt="Icon preview" className="w-16 h-16 object-contain border rounded" />
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={saving || !name.trim() || !slug.trim()} className="flex-1">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {initialData ? 'Сохранить' : 'Создать пак'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
