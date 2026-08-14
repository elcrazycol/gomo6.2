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
        // Logged out: drop per-user state (privacy) but keep the emoji map so
        // posts and nicknames already on screen keep rendering.
        setSubscribedPacks([]);
        setOwnedPacks([]);
        setSubscribedPackIds(new Set());
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
      // Emojis that just arrived are known — unmark any stale failure records.
      setFailedEmojiIds(prev => {
        if (prev.size === 0 || emojiMap.size === 0) return prev;
        const next = new Set(prev);
        for (const id of emojiMap.keys()) next.delete(id);
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

  const mergeResolvedEmojis = useCallback((resolved: EmojiData[], requested: string[]) => {
    setAllEmojis(prev => {
      const next = new Map(prev);
      for (const emoji of resolved) next.set(emoji.id, emoji);
      return next;
    });
    setFailedEmojiIds(prev => {
      const next = new Set(prev);
      // Any id that came back is known — never mark it failed again this session.
      for (const emoji of resolved) next.delete(emoji.id);
      // Ids the server did not return are genuinely missing (deleted emoji):
      // remember them so we do not re-request them on every render.
      for (const id of requested) {
        if (!resolved.some(emoji => emoji.id === id)) next.add(id);
      }
      return next;
    });
  }, []);

  const resolveEmojis = useCallback(async (ids: string[]) => {
    const unresolved = ids.filter(id => !allEmojis.has(id) && !failedEmojiIds.has(id));
    if (unresolved.length === 0) return;

    const toArray = (data: unknown): EmojiData[] => {
      if (Array.isArray(data)) return data as EmojiData[];
      return data ? [data as EmojiData] : [];
    };

    try {
      // Primary path: the REST endpoint through the shared client (cookies,
      // CSRF, refresh) — it is rate-limited under the generous generic budgets.
      const rest = await apiClient.rawRequest<unknown>('/api/v1/custom_emojis/resolve', {
        method: 'POST',
        body: JSON.stringify({ ids: unresolved }),
      });
      const resolved = toArray(rest.data ?? rest);
      if (resolved.length > 0 || rest.data !== null) {
        mergeResolvedEmojis(resolved, unresolved);
        return;
      }
    } catch {
      // fall through to the RPC surface below
    }

    try {
      // Fallback: the public RPC endpoint (identical handler, stricter per-IP
      // budget — only hit when the primary path fails).
      const rpcResult = await api.rpc('resolve_emojis', { ids: unresolved });
      if (rpcResult.error && !rpcResult.data) throw rpcResult.error;
      const resolved = toArray(rpcResult.data);
      mergeResolvedEmojis(resolved, unresolved);
    } catch (err) {
      console.error('Error resolving emojis:', err);
    }
  }, [allEmojis, failedEmojiIds, mergeResolvedEmojis]);

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
