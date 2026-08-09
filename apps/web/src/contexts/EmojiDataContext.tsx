import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/integrations/api/compat';
import { apiClient } from '@/integrations/api/client';
import { storageUrl } from '@/utils/storage';

export interface EmojiData {
  id: string;
  pack_id: string;
  name: string;
  image_url: string;
  is_animated: boolean;
  unicode_triggers: string[];
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
  ownedPacks: EmojiPackData[];
  isLoading: boolean;
  resolveEmojis: (ids: string[]) => Promise<void>;
  subscribeToPack: (packId: string) => Promise<void>;
  unsubscribeFromPack: (packId: string) => Promise<void>;
  refreshData: () => Promise<void>;
  getEmojiUrl: (emojiId: string) => string | null;
  customEmojiList: EmojiData[];
}

const EmojiDataContext = createContext<EmojiDataContextValue | null>(null);

export const EmojiDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allEmojis, setAllEmojis] = useState<Map<string, EmojiData>>(new Map());
  const [subscribedPackIds, setSubscribedPackIds] = useState<Set<string>>(new Set());
  const [subscribedPacks, setSubscribedPacks] = useState<EmojiPackData[]>([]);
  const [ownedPacks, setOwnedPacks] = useState<EmojiPackData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failedEmojiIds, setFailedEmojiIds] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);

  const loadSubscribedData = useCallback(async () => {
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const result = await apiClient.rawRequest<EmojiPackData[]>('/api/v1/my-emoji-subscriptions');
      const ownPacksResult = await apiClient.rawRequest<EmojiPackData[]>('/api/v1/my-emoji-packs');

      const toPackArray = (data: EmojiPackData | EmojiPackData[] | null): EmojiPackData[] => {
        if (Array.isArray(data)) return data as EmojiPackData[];
        return data ? [data as EmojiPackData] : [];
      };
      const subscribed = toPackArray(result.data as EmojiPackData | EmojiPackData[] | null);
      const owned = toPackArray(ownPacksResult.data as EmojiPackData | EmojiPackData[] | null);
      const packMap = new Map<string, EmojiPackData>();
      for (const pack of [...subscribed, ...owned]) packMap.set(pack.id, pack);
      const packs = Array.from(packMap.values());
      setSubscribedPacks(subscribed);
      setOwnedPacks(owned);
      setSubscribedPackIds(new Set(subscribed.map(p => p.id)));

      const emojiMap = new Map<string, EmojiData>();
      for (const pack of packs) {
        if (pack.emojis) {
          for (const emoji of pack.emojis) {
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
    const unresolved = ids.filter(id => !allEmojis.has(id) && !failedEmojiIds.has(id));
    if (unresolved.length === 0) return;

    try {
      const rpcResult = await api.rpc('resolve_emojis', { ids: unresolved });
      const resolved = (Array.isArray(rpcResult.data)
        ? rpcResult.data
        : rpcResult.data
          ? [rpcResult.data]
          : []) as EmojiData[];
      if (resolved.length > 0 || rpcResult.data !== null) {
        setAllEmojis(prev => {
          const next = new Map(prev);
          for (const emoji of resolved) next.set(emoji.id, emoji);
          return next;
        });
        setFailedEmojiIds(prev => {
          const next = new Set(prev);
          for (const emoji of resolved) next.delete(emoji.id);
          for (const id of unresolved) if (!resolved.some((emoji) => emoji.id === id)) next.add(id);
          return next;
        });
      }
    } catch {
      // Try the REST endpoint through the shared client so browser cookies,
      // CSRF and auth refresh behavior remain identical to the RPC path.
      try {
        const fallback = await apiClient.rawRequest<EmojiData[]>('/api/v1/custom_emojis/resolve', {
          method: 'POST',
          body: JSON.stringify({ ids: unresolved }),
        });
        const resolved = (Array.isArray(fallback.data)
          ? fallback.data
          : fallback.data
            ? [fallback.data]
            : []) as EmojiData[];
        setAllEmojis(prev => {
          const next = new Map(prev);
          for (const emoji of resolved) next.set(emoji.id, emoji);
          return next;
        });
        setFailedEmojiIds(prev => {
          const next = new Set(prev);
          for (const emoji of resolved) next.delete(emoji.id);
          for (const id of unresolved) if (!resolved.some((emoji) => emoji.id === id)) next.add(id);
          return next;
        });
      } catch (err) {
        console.error('Error resolving emojis:', err);
      }
    }
  }, [allEmojis, failedEmojiIds]);

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
      ownedPacks,
      isLoading,
      resolveEmojis,
      subscribeToPack,
      unsubscribeFromPack,
      refreshData,
      getEmojiUrl,
      customEmojiList: Array.from(allEmojis.values()),
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
