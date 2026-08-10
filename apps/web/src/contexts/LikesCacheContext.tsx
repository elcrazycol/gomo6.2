import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { api } from '@/integrations/api/compat';

interface LikeData {
  count: number;
  isLiked: boolean;
  timestamp: number;
}

interface LikesCacheContextType {
  getLikeData: (postId: string, isThread: boolean) => LikeData | null;
  loadLikeData: (postId: string, userId: string | null, isThread: boolean) => Promise<LikeData>;
  loadLikeDataBatch: (postIds: string[], userId: string | null, isThread: boolean) => Promise<void>;
  updateLikeData: (postId: string, isThread: boolean, isLiked: boolean, count: number) => void;
  clearCache: () => void;
}

const LikesCacheContext = createContext<LikesCacheContextType | undefined>(undefined);

const CACHE_TTL = 30000; // 30 seconds
const MAX_CACHE_SIZE = 200;

export const LikesCacheProvider = ({ children }: { children: ReactNode }) => {
  const [cache, setCache] = useState<Map<string, LikeData>>(new Map());
  const pendingRequests = useRef(new Map<string, Promise<LikeData>>());
  // Batch requests resolve to void (they only fill the cache), so they need
  // their own pending map — the per-item map is typed Promise<LikeData>.
  const pendingBatchRequests = useRef(new Map<string, Promise<void>>());

  const getCacheKey = (postId: string, isThread: boolean) => `${isThread ? 'thread' : 'post'}:${postId}`;

  const getLikeData = useCallback((postId: string, isThread: boolean): LikeData | null => {
    const key = getCacheKey(postId, isThread);
    const cached = cache.get(key);

    if (!cached) return null;

    // Check if cache is still valid
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      setCache(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return null;
    }

    return cached;
  }, [cache]);

  const loadLikeData = useCallback(async (
    postId: string,
    userId: string | null,
    isThread: boolean
  ): Promise<LikeData> => {
    const key = getCacheKey(postId, isThread);

    // Check cache first
    const cached = getLikeData(postId, isThread);
    if (cached) return cached;

    // Check if request is already pending
    const pending = pendingRequests.current.get(key);
    if (pending) return pending;

    // Create new request
    const request = (async () => {
      try {
        const countFunction = isThread ? 'get_thread_likes_count' : 'get_post_likes_count';
        const hasLikedFunction = isThread ? 'has_user_liked_thread' : 'has_user_liked_post';

        const promises: Promise<{ data?: number | boolean }>[] = [
          api.rpc(countFunction, {
            [isThread ? 'thread_uuid' : 'post_uuid']: postId
          }) as Promise<{ data?: number | boolean }>
        ];

        if (userId) {
          promises.push(
            api.rpc(hasLikedFunction, {
              [isThread ? 'thread_uuid' : 'post_uuid']: postId,
              user_uuid: userId
            }) as Promise<{ data?: number | boolean }>
          );
        }

        const results = await Promise.all(promises);
        const count = (results[0] as { data?: number }).data || 0;
        const isLiked = userId ? ((results[1] as unknown as { data?: boolean })?.data || false) : false;

        const likeData: LikeData = {
          count,
          isLiked,
          timestamp: Date.now()
        };

        // Update cache
        setCache(prev => {
          const next = new Map(prev);

          // Limit cache size
          if (next.size >= MAX_CACHE_SIZE) {
            const firstKey = next.keys().next().value;
            if (firstKey) next.delete(firstKey);
          }

          next.set(key, likeData);
          return next;
        });

        return likeData;
      } catch (error) {
        // Silently return empty data on network errors — UI will show 0 likes
        console.warn('Failed to load like data:', (error as Error).message);
        return { count: 0, isLiked: false, timestamp: Date.now() };
      } finally {
        // Remove from pending
        pendingRequests.current.delete(key);
      }
    })();

    pendingRequests.current.set(key, request);
    return request;
  }, [getLikeData, pendingRequests]);

  // Batch loader: fills the cache for many posts/threads with a SINGLE
  // batch RPC (get_post_likes_batch / get_thread_likes_batch) instead of two
  // per item. Individual LikeButtons then hit the cache with 0 requests.
  // Misses (e.g. a like that happened while the batch was in flight) fall
  // back to loadLikeData's per-item fetch.
  const loadLikeDataBatch = useCallback(async (
    postIds: string[],
    userId: string | null,
    isThread: boolean
  ): Promise<void> => {
    // Deduplicate and drop ids already present in the cache.
    const ids = [...new Set(postIds)].filter(id => !getLikeData(id, isThread));
    if (ids.length === 0) return;

    const key = `batch:${isThread ? 'thread' : 'post'}:${ids.join(',')}:${userId || 'anon'}`;
    const pending = pendingBatchRequests.current.get(key);
    if (pending) {
      try { await pending; } catch { /* noop */ }
      return;
    }

    const request = (async () => {
      try {
        const batchFunction = isThread ? 'get_thread_likes_batch' : 'get_post_likes_batch';
        const { data: items } = await api.rpc(batchFunction, {
          [isThread ? 'thread_ids' : 'post_ids']: ids.join(','),
          user_uuid: userId || ''
        }) as { data?: Array<{ thread_id?: string; post_id?: string; count?: number; is_liked?: boolean }> };

        const now = Date.now();
        setCache(prev => {
          const next = new Map(prev);
          for (const item of items || []) {
            const id = isThread ? item.thread_id : item.post_id;
            if (!id) continue;
            const itemKey = getCacheKey(id, isThread);
            // Keep the newest data if something was written while we fetched
            const existing = next.get(itemKey);
            if (existing && existing.timestamp > now) continue;

            if (next.size >= MAX_CACHE_SIZE) {
              const firstKey = next.keys().next().value;
              if (firstKey) next.delete(firstKey);
            }
            next.set(itemKey, {
              count: item.count ?? 0,
              isLiked: !!item.is_liked,
              timestamp: now
            });
          }
          return next;
        });
      } catch (error) {
        // Individual LikeButtons will retry per-item on next mount; the batch
        // is an optimization, not a correctness dependency.
        console.warn('Failed to load like data batch:', (error as Error).message);
      } finally {
        pendingBatchRequests.current.delete(key);
      }
    })();

    pendingBatchRequests.current.set(key, request);
    try { await request; } catch { /* noop */ }
  }, [getLikeData, pendingBatchRequests]);

  const updateLikeData = useCallback((
    postId: string,
    isThread: boolean,
    isLiked: boolean,
    count: number
  ) => {
    const key = getCacheKey(postId, isThread);
    setCache(prev => {
      const next = new Map(prev);
      next.set(key, {
        count,
        isLiked,
        timestamp: Date.now()
      });
      return next;
    });
  }, []);

  const clearCache = useCallback(() => {
    setCache(new Map());
    pendingRequests.current.clear();
    pendingBatchRequests.current.clear();
  }, []);

  return (
    <LikesCacheContext.Provider value={{ getLikeData, loadLikeData, loadLikeDataBatch, updateLikeData, clearCache }}>
      {children}
    </LikesCacheContext.Provider>
  );
};

export const useLikesCache = () => {
  const context = useContext(LikesCacheContext);
  if (!context) {
    throw new Error('useLikesCache must be used within LikesCacheProvider');
  }
  return context;
};
