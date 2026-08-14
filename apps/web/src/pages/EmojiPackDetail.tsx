import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEmojiData, EmojiPackData, EmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Users, Plus, Check } from 'lucide-react';
import { EmojiGrid } from '@/components/emoji/EmojiGrid';

export default function EmojiPackDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { subscribedPackIds, subscribeToPack, unsubscribeFromPack } = useEmojiData();
  const [pack, setPack] = useState<EmojiPackData | null>(null);
  const [emojis, setEmojis] = useState<EmojiData[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);

  const loadPack = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/v1/emoji_packs/by-slug/${slug}`);
      const json = await res.json();
      if (json.success && json.data) {
        setPack(json.data);
        setEmojis(json.data.emojis || []);
      } else {
        toast.error('Пак не найден');
        navigate('/emojis');
      }
    } catch (err) {
      console.error('Error loading pack:', err);
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [slug, navigate]);

  useEffect(() => { loadPack(); }, [loadPack]);

  const isSubscribed = pack ? subscribedPackIds.has(pack.id) : false;

  const handleToggleSubscribe = async () => {
    if (!pack) return;
    setSubscribing(true);
    try {
      if (isSubscribed) {
        const ok = await unsubscribeFromPack(pack.id);
        toast.success(ok ? 'Пак удалён' : 'Не удалось отписаться');
      } else {
        // Pass the full pack so the optimistic update makes it available in
        // the picker instantly — no waiting for the subscriptions round-trip.
        const ok = await subscribeToPack(pack.id, pack);
        toast.success(ok ? 'Пак установлен!' : 'Не удалось установить пак');
      }
    } finally {
      setSubscribing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!pack) return null;

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center gap-2 sm:gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Назад">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3">
              {pack.icon_url ? (
                <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-10 h-10 sm:w-12 sm:h-12 object-contain rounded-lg shrink-0" />
              ) : (
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
                  <Package className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">{pack.name}</h1>
                <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground">
                  <span>{emojis.length} эмодзи</span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {pack.subscriber_count}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <Button
            onClick={handleToggleSubscribe}
            disabled={subscribing}
            variant={isSubscribed ? "outline" : "default"}
            size="sm"
            className="shrink-0 px-2.5 sm:px-3"
            title={isSubscribed ? 'Отписаться от пака' : 'Установить пак'}
            aria-label={isSubscribed ? 'Пак установлен — отписаться' : 'Установить пак'}
          >
            {isSubscribed ? (
              <>
                <Check className="h-4 w-4" />
                <span className="hidden sm:inline">Установлен</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Добавить</span>
              </>
            )}
          </Button>
        </div>

        {pack.description && (
          <p className="text-muted-foreground mb-6">{pack.description}</p>
        )}

        <EmojiGrid emojis={emojis} />
      </div>
    </div>
  );
}
