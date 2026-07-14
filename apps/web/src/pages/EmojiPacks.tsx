import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, Plus, Package } from 'lucide-react';
import { EmojiPackCard } from '@/components/emoji/EmojiPackCard';
import type { EmojiPackData } from '@/contexts/EmojiDataContext';

export default function EmojiPacks() {
  const [packs, setPacks] = useState<EmojiPackData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadPacks = useCallback(async () => {
    try {
      let query = api
        .from('emoji_packs')
        .select('*')
        .eq('is_public', true)
        .order('subscriber_count', { ascending: false });

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data } = await query.limit(50);
      setPacks(data || []);
    } catch (err) {
      console.error('Error loading packs:', err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadPacks(); }, [loadPacks]);

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Паки эмодзи</h1>
          <div className="flex-1" />
          <Link to="/emojis/my">
            <Button variant="outline" size="sm">Мои паки</Button>
          </Link>
          <Link to="/emojis/create">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Создать
            </Button>
          </Link>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Найти пак..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
        ) : packs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg mb-1">Паки не найдены</p>
            <p className="text-sm">Создайте первый пак!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {packs.map(pack => (
              <EmojiPackCard key={pack.id} pack={pack} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
