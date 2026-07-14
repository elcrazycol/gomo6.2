import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { useEmojiData, EmojiPackData, EmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Users, Download, Check } from 'lucide-react';
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
        await unsubscribeFromPack(pack.id);
        toast.success('Отписано');
      } else {
        await subscribeToPack(pack.id);
        toast.success('Подписано!');
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
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              {pack.icon_url ? (
                <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-12 h-12 object-contain rounded-lg" />
              ) : (
                <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                  <Package className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold">{pack.name}</h1>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
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
          >
            {isSubscribed ? (
              <><Check className="h-4 w-4 mr-1" /> Установлен</>
            ) : (
              <><Download className="h-4 w-4 mr-1" /> Установить</>
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
