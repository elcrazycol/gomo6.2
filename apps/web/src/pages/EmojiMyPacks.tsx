import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Package, Download, ExternalLink } from 'lucide-react';

interface PackData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  emoji_count: number;
  subscriber_count: number;
}

export default function EmojiMyPacks() {
  const navigate = useNavigate();
  const { subscribedPackIds, subscribedPacks, refreshData, unsubscribeFromPack } = useEmojiData();
  const [myPacks, setMyPacks] = useState<PackData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) { navigate('/auth'); return; }

      const { data } = await api
        .from('emoji_packs')
        .select('*')
        .eq('author_id', user.id)
        .order('created_at', { ascending: false });

      setMyPacks(data || []);
    } catch (err) {
      console.error('Error loading packs:', err);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleUninstall = async (packId: string) => {
    await unsubscribeFromPack(packId);
    toast.success('Пак отписан');
  };

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Мои паки</h1>
        </div>

        {/* My packs */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Созданные паки</h2>
            <Link to="/emojis/create">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Создать
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : myPacks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Вы ещё не создали ни одного пака</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myPacks.map(pack => (
                <Link
                  key={pack.id}
                  to={`/emojis/edit/${pack.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  {pack.icon_url ? (
                    <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-10 h-10 object-contain" />
                  ) : (
                    <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{pack.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {pack.emoji_count} эмодзи · {pack.subscriber_count} подписчиков
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Subscribed packs */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Подписки</h2>
          {subscribedPacks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Download className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Вы не подписаны ни на один пак</p>
              <Link to="/emojis">
                <Button variant="outline" size="sm" className="mt-2">Найти паки</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {subscribedPacks.map(pack => (
                <div key={pack.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  {pack.icon_url ? (
                    <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-10 h-10 object-contain" />
                  ) : (
                    <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                      <Package className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{pack.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {pack.emoji_count} эмодзи
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleUninstall(pack.id)}>
                    Отписаться
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
