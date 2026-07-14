import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/integrations/api/compat';
import { storageUrl } from '@/utils/storage';

export interface EmojiData {
  id: string;
  pack_id: string;
  name: string;
  image_url: string;
  is_animated: boolean;
}

export interface EmojiPackData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  author_id: string;
  emoji_count: number;
  subscriber_count: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  emojis?: EmojiData[];
}

interface EmojiDataContextValue {
  allEmojis: Map<string, EmojiData>;
  subscribedPackIds: Set<string>;
  subscribedPacks: EmojiPackData[];
  isLoading: boolean;
  resolveEmojis: (ids: string[]) => Promise<void>;
  subscribeToPack: (packId: string) => Promise<void>;
  unsubscribeFromPack: (packId: string) => Promise<void>;
  refreshData: () => Promise<void>;
  getEmojiUrl: (emojiId: string) => string | null;
}

const EmojiDataContext = createContext<EmojiDataContextValue | null>(null);

export const EmojiDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allEmojis, setAllEmojis] = useState<Map<string, EmojiData>>(new Map());
  const [subscribedPackIds, setSubscribedPackIds] = useState<Set<string>>(new Set());
  const [subscribedPacks, setSubscribedPacks] = useState<EmojiPackData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadingRef = useRef(false);

  const loadSubscribedData = useCallback(async () => {
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data: subs } = await api
        .from('user_emoji_subscriptions')
        .select('pack_id')
        .eq('user_id', user.id);

      if (!subs || subs.length === 0) {
        setIsLoading(false);
        return;
      }

      const packIds = subs.map((s: Record<string, unknown>) => s.pack_id as string);
      setSubscribedPackIds(new Set(packIds));

      const { data: packs } = await api
        .from('emoji_packs')
        .select('*')
        .in('id', packIds);

      if (packs) {
        setSubscribedPacks(packs as EmojiPackData[]);

        const emojiMap = new Map<string, EmojiData>();
        for (const pack of packs) {
          const p = pack as EmojiPackData;
          if (p.emojis) {
            for (const emoji of p.emojis) {
              emojiMap.set(emoji.id, emoji);
            }
          }
        }
        setAllEmojis(prev => {
          const next = new Map(prev);
          for (const [k, v] of emojiMap) {
            next.set(k, v);
          }
          return next;
        });
      }
    } catch (err) {
      console.error('Error loading emoji subscriptions:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loadingRef.current) {
      loadingRef.current = true;
      loadSubscribedData();
    }
  }, [loadSubscribedData]);

  const resolveEmojis = useCallback(async (ids: string[]) => {
    const unresolved = ids.filter(id => !allEmojis.has(id));
    if (unresolved.length === 0) return;

    try {
      const { data } = await api.rpc('resolve_emojis', { ids: unresolved });
      if (data && Array.isArray(data)) {
        setAllEmojis(prev => {
          const next = new Map(prev);
          for (const emoji of data) {
            next.set(emoji.id, emoji);
          }
          return next;
        });
      }
    } catch {
      // Try POST endpoint fallback
      try {
        const response = await fetch('/api/v1/custom_emojis/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: unresolved }),
        });
        const result = await response.json();
        if (result.success && result.data) {
          setAllEmojis(prev => {
            const next = new Map(prev);
            for (const emoji of result.data) {
              next.set(emoji.id, emoji);
            }
            return next;
          });
        }
      } catch (err) {
        console.error('Error resolving emojis:', err);
      }
    }
  }, [allEmojis]);

  const subscribeToPack = useCallback(async (packId: string) => {
    const { data: { user } } = await api.auth.getUser();
    if (!user) return;

    const { error } = await api
      .from('user_emoji_subscriptions')
      .insert({ user_id: user.id, pack_id: packId });

    if (!error) {
      setSubscribedPackIds(prev => new Set([...prev, packId]));
      await refreshData();
    }
  }, []);

  const unsubscribeFromPack = useCallback(async (packId: string) => {
    const { data: { user } } = await api.auth.getUser();
    if (!user) return;

    const { error } = await api
      .from('user_emoji_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('pack_id', packId);

    if (!error) {
      setSubscribedPackIds(prev => {
        const next = new Set(prev);
        next.delete(packId);
        return next;
      });
      setSubscribedPacks(prev => prev.filter(p => p.id !== packId));
    }
  }, []);

  const refreshData = useCallback(async () => {
    loadingRef.current = false;
    await loadSubscribedData();
  }, [loadSubscribedData]);

  const getEmojiUrl = useCallback((emojiId: string): string | null => {
    const emoji = allEmojis.get(emojiId);
    if (!emoji) return null;
    return storageUrl('emojis', emoji.image_url);
  }, [allEmojis]);

  return (
    <EmojiDataContext.Provider value={{
      allEmojis,
      subscribedPackIds,
      subscribedPacks,
      isLoading,
      resolveEmojis,
      subscribeToPack,
      unsubscribeFromPack,
      refreshData,
      getEmojiUrl,
    }}>
      {children}
    </EmojiDataContext.Provider>
  );
};

export const useEmojiData = () => {
  const context = useContext(EmojiDataContext);
  if (!context) {
    throw new Error('useEmojiData must be used within EmojiDataProvider');
  }
  return context;
};
