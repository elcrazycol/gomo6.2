import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { storageUrl, uploadFile, removeFile } from '@/utils/storage';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmojiPackForm } from '@/components/emoji/EmojiPackForm';
import { EmojiUploader } from '@/components/emoji/EmojiUploader';
import { EmojiGrid } from '@/components/emoji/EmojiGrid';
import { EmojiTriggerInput } from '@/components/emoji/EmojiTriggerInput';
import { ArrowLeft, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { CompressionResult } from '@/utils/emojiCompression';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import type { EmojiData } from '@/contexts/EmojiDataContext';

interface PackData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  author_id: string;
  emoji_count: number;
}

export default function EmojiPackEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshData } = useEmojiData();
  const [pack, setPack] = useState<PackData | null>(null);
  const [emojis, setEmojis] = useState<EmojiData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [addingEmoji, setAddingEmoji] = useState(false);
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>([]);

  const loadPack = useCallback(async () => {
    if (!id) return;
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) { navigate('/auth'); return; }
      const { data: packData } = await api.from('emoji_packs').select('*').eq('id', id).single();
      if (!packData || packData.author_id !== user.id) {
        toast.error('Пак не найден');
        navigate('/emojis/my');
        return;
      }
      setPack(packData);
      const { data: emojiData } = await api.from('custom_emojis').select('*').eq('pack_id', id).order('sort_order');
      setEmojis((emojiData || []).map((emoji: EmojiData) => ({ ...emoji, unicode_triggers: emoji.unicode_triggers || [] })));
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
    if (selectedTriggers.length === 0) {
      toast.error('Добавьте хотя бы один обычный эмодзи-триггер');
      return;
    }
    setAddingEmoji(true);
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) return;
      const ext = result.file.name.split('.').pop() || 'webp';
      const emojiName = result.file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim() || 'custom emoji';
      const key = `${user.id}/${pack.slug}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      await uploadFile('emojis', key, result.file, undefined, false);
      const { error } = await api.from('custom_emojis').insert({
        pack_id: pack.id,
        name: emojiName,
        image_url: key,
        is_animated: result.isAnimated,
        unicode_triggers: selectedTriggers,
        sort_order: emojis.length,
      });
      if (error) throw error;
      setSelectedTriggers([]);
      toast.success('Эмодзи добавлен');
      await loadPack();
      // Keep the shared emoji state (picker, picker tabs) in sync right away.
      void refreshData();
    } catch (err) {
      console.error('Error adding emoji:', err);
      toast.error('Ошибка добавления эмодзи');
    } finally {
      setAddingEmoji(false);
    }
  };

  const handleRemoveEmoji = async (emojiId: string) => {
    const emoji = emojis.find((item) => item.id === emojiId);
    if (!emoji || !window.confirm('Удалить этот эмодзи из пака?')) return;
    try {
      const { error } = await api.from('custom_emojis').delete().eq('id', emojiId);
      if (error) throw error;
      await removeFile('emojis', emoji.image_url).catch(() => undefined);
      toast.success('Эмодзи удалён');
      await loadPack();
      void refreshData();
    } catch (err) {
      console.error('Error removing emoji:', err);
      toast.error('Ошибка удаления');
    }
  };

  if (loading) return <div className="bg-background min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!pack) return null;

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/emojis/my')}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-bold">{pack.name}</h1><p className="text-sm text-muted-foreground">/{pack.slug} · {emojis.length} эмодзи</p></div>
          <Button variant="outline" size="sm" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Скрыть' : 'Настроить пак'}</Button>
        </div>

        {showForm && <div className="mb-6 rounded-2xl border border-border/70 bg-card p-4"><EmojiPackForm initialData={pack} onSuccess={() => { setShowForm(false); loadPack(); void refreshData(); }} onCancel={() => setShowForm(false)} /></div>}

        <div className="mb-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-5">
          <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-primary/15 p-2 text-primary"><Sparkles className="h-5 w-5" /></div><div><h2 className="font-semibold">Добавить кастомный эмодзи</h2><p className="text-sm text-muted-foreground">Картинка будет уменьшена на вашем устройстве. Пользователи будут находить её по обычным эмодзи, без :имён:.</p></div></div>
          <div className="mb-4"><EmojiTriggerInput value={selectedTriggers} onChange={setSelectedTriggers} disabled={addingEmoji} /></div>
          <EmojiUploader onUpload={handleAddEmoji} disabled={addingEmoji || selectedTriggers.length === 0} />
          {addingEmoji && <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Сохраняем эмодзи…</div>}
        </div>

        <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-semibold">Эмодзи в паке</h2><span className="text-xs text-muted-foreground">до 3 триггеров на картинку</span></div>
        <EmojiGrid emojis={emojis} onRemove={handleRemoveEmoji} />
      </div>
    </div>
  );
}
