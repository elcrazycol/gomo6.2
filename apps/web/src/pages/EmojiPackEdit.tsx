import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { storageUrl, uploadFile } from '@/utils/storage';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmojiPackForm } from '@/components/emoji/EmojiPackForm';
import { EmojiUploader } from '@/components/emoji/EmojiUploader';
import { EmojiGrid } from '@/components/emoji/EmojiGrid';
import { ArrowLeft, Plus, Loader2 } from 'lucide-react';
import { CompressionResult, processEmojiImage, validateEmojiFile } from '@/utils/emojiCompression';

interface PackData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  author_id: string;
  emoji_count: number;
}

interface EmojiData {
  id: string;
  pack_id: string;
  name: string;
  image_url: string;
  is_animated: boolean;
}

export default function EmojiPackEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pack, setPack] = useState<PackData | null>(null);
  const [emojis, setEmojis] = useState<EmojiData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [addingEmoji, setAddingEmoji] = useState(false);

  const loadPack = useCallback(async () => {
    if (!id) return;
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) { navigate('/auth'); return; }

      const { data: packData } = await api
        .from('emoji_packs')
        .select('*')
        .eq('id', id)
        .single();

      if (!packData || packData.author_id !== user.id) {
        toast.error('Пак не найден');
        navigate('/emojis/my');
        return;
      }

      setPack(packData);

      const { data: emojiData } = await api
        .from('custom_emojis')
        .select('*')
        .eq('pack_id', id)
        .order('sort_order');

      setEmojis(emojiData || []);
    } catch (err) {
      console.error('Error loading pack:', err);
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { loadPack(); }, [loadPack]);

  const handleAddEmoji = async (result: CompressionResult & { file: File }) => {
    if (!pack) return;
    setAddingEmoji(true);
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) return;

      const ext = result.file.name.split('.').pop() || 'webp';
      const emojiName = result.file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
      const key = `${user.id}/${pack.slug}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;

      await uploadFile('emojis', key, result.file);

      const { error } = await api
        .from('custom_emojis')
        .insert({
          pack_id: pack.id,
          name: emojiName,
          image_url: key,
          is_animated: result.isAnimated,
          sort_order: emojis.length,
        });

      if (error) throw error;

      toast.success('Эмодзи добавлен');
      await loadPack();
    } catch (err) {
      console.error('Error adding emoji:', err);
      toast.error('Ошибка добавления');
    } finally {
      setAddingEmoji(false);
    }
  };

  const handleRemoveEmoji = async (emojiId: string) => {
    try {
      const { error } = await api
        .from('custom_emojis')
        .delete()
        .eq('id', emojiId);

      if (error) throw error;
      toast.success('Эмодзи удалён');
      await loadPack();
    } catch (err) {
      console.error('Error removing emoji:', err);
      toast.error('Ошибка удаления');
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pack) return null;

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/emojis/my')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{pack.name}</h1>
            <p className="text-sm text-muted-foreground">/{pack.slug} · {emojis.length} эмодзи</p>
          </div>
        </div>

        {showForm ? (
          <div className="mb-6">
            <EmojiPackForm
              initialData={pack}
              onSuccess={() => { setShowForm(false); loadPack(); }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        ) : (
          <Button variant="outline" onClick={() => setShowForm(true)} className="mb-6">
            Редактировать название
          </Button>
        )}

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Эмодзи в паке</h2>

          <EmojiUploader onUpload={handleAddEmoji} disabled={addingEmoji} />

          {addingEmoji && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка...
            </div>
          )}

          <EmojiGrid emojis={emojis} onRemove={handleRemoveEmoji} />
        </div>
      </div>
    </div>
  );
}
