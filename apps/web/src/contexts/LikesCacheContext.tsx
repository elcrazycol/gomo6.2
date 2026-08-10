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
  // Batch requests need their own pending map — the per-item map is typed
  // Promise<LikeData>. Batch promises resolve to the fetched per-id data.
  const pendingBatchRequests = useRef(new Map<string, Promise<Array<{ id: string; count: number; isLiked: boolean }>>>());
  // Coalescing queue: per-item loadLikeData calls made within the same tick
  // are collected here and flushed as ONE batch RPC. This covers the very
  // first render of a page — LikeButton effects (children) run before any
  // parent preload effect, so a preload alone cannot prevent the per-item
  // storm. Coalescing fixes it structurally: N buttons → 1 request.
  const coalesceWaiters = useRef(new Map<string, Array<(d: LikeData) => void>>());
  const coalesceMeta = useRef(new Map<string, { userId: string | null; isThread: boolean }>());
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Batch loader: fills the cache for many posts/threads with a SINGLE
  // batch RPC (get_post_likes_batch / get_thread_likes_batch) instead of two
  // per item. Individual LikeButtons then hit the cache with 0 requests.
  // Returns the fetched per-id data so coalescing can resolve its waiters
  // directly (the cache state is not yet applied to this closure's reads).
  const fetchBatchData = useCallback(async (
    postIds: string[],
    userId: string | null,
    isThread: boolean
  ): Promise<Array<{ id: string; count: number; isLiked: boolean }>> => {
    // Deduplicate. Ids already present in the cache are still returned (from
    // the cache) so coalescing waiters always resolve with real data instead
    // of zeros — e.g. if updateLikeData ran between queueing and the flush.
    const uniqueIds = [...new Set(postIds)];
    const ids: string[] = [];
    const cachedFetched: Array<{ id: string; count: number; isLiked: boolean }> = [];
    for (const id of uniqueIds) {
      const cached = getLikeData(id, isThread);
      if (cached) {
        cachedFetched.push({ id, count: cached.count, isLiked: cached.isLiked });
      } else {
        ids.push(id);
      }
    }
    if (ids.length === 0) return cachedFetched;

    const key = `batch:${isThread ? 'thread' : 'post'}:${ids.join(',')}:${userId || 'anon'}`;
    const pending = pendingBatchRequests.current.get(key);
    if (pending) {
      try { await pending; } catch { /* noop */ }
      return [];
    }

    const request = (async (): Promise<Array<{ id: string; count: number; isLiked: boolean }>> => {
      try {
        const batchFunction = isThread ? 'get_thread_likes_batch' : 'get_post_likes_batch';
        const { data: items } = await api.rpc(batchFunction, {
          [isThread ? 'thread_ids' : 'post_ids']: ids.join(','),
          user_uuid: userId || ''
        }) as { data?: Array<{ thread_id?: string; post_id?: string; count?: number; is_liked?: boolean }> };

        const now = Date.now();
        const fetched: Array<{ id: string; count: number; isLiked: boolean }> = [...cachedFetched];
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
            const likeData = { count: item.count ?? 0, isLiked: !!item.is_liked };
            next.set(itemKey, { ...likeData, timestamp: now });
            fetched.push({ id, ...likeData });
          }
          return next;
        });
        return fetched;
      } catch (error) {
        // Individual LikeButtons will retry per-item on next mount; the batch
        // is an optimization, not a correctness dependency.
        console.warn('Failed to load like data batch:', (error as Error).message);
        return [];
      } finally {
        pendingBatchRequests.current.delete(key);
      }
    })();

    pendingBatchRequests.current.set(key, request);
    try { return await request; } catch { return []; }
  }, [getLikeData, pendingBatchRequests]);

  const loadLikeDataBatch = useCallback(async (
    postIds: string[],
    userId: string | null,
    isThread: boolean
  ): Promise<void> => {
    await fetchBatchData(postIds, userId, isThread);
  }, [fetchBatchData]);

  // Flush the coalescing queue: group queued ids by (isThread, userId) and
  // fetch each group with a single batch RPC, then resolve every waiter with
  // the fetched data (the cache state is not yet readable in this closure).
  const flushCoalesce = useCallback(async () => {
    if (coalesceTimer.current !== null) {
      clearTimeout(coalesceTimer.current);
      coalesceTimer.current = null;
    }
    const waitersMap = coalesceWaiters.current;
    const metaMap = coalesceMeta.current;
    if (waitersMap.size === 0) return;
    coalesceWaiters.current = new Map();
    coalesceMeta.current = new Map();

    // Group by (isThread, userId) → one batch RPC per group.
    const groups = new Map<string, { userId: string | null; isThread: boolean; ids: string[] }>();
    for (const [key] of waitersMap) {
      const colonIdx = key.indexOf(':');
      const type = key.slice(0, colonIdx);
      const id = key.slice(colonIdx + 1);
      const meta = metaMap.get(key);
      if (!meta) continue;
      const gk = `${type}:${meta.userId || 'anon'}`;
      let group = groups.get(gk);
      if (!group) {
        group = { userId: meta.userId, isThread: type === 'thread', ids: [] };
        groups.set(gk, group);
      }
      group.ids.push(id);
    }

    // Fetch each group (batch errors are swallowed inside fetchBatchData).
    const results: Record<string, { count: number; isLiked: boolean }> = {};
    for (const group of groups.values()) {
      const fetched = await fetchBatchData(group.ids, group.userId, group.isThread);
      for (const item of fetched) {
        results[item.id] = { count: item.count, isLiked: item.isLiked };
      }
    }

    // Resolve waiters with the fetched data; fall back to zeros if missing.
    const now = Date.now();
    for (const [key, resolvers] of waitersMap) {
      const colonIdx = key.indexOf(':');
      const id = key.slice(colonIdx + 1);
      const res = results[id] ?? { count: 0, isLiked: false };
      const data: LikeData = { ...res, timestamp: now };
      for (const resolve of resolvers) resolve(data);
      pendingRequests.current.delete(key);
    }
  }, [fetchBatchData]);

  const loadLikeData = useCallback(async (
    postId: string,
    userId: string | null,
    isThread: boolean
  ): Promise<LikeData> => {
    const key = getCacheKey(postId, isThread);

    // Check cache first
    const cached = getLikeData(postId, isThread);
    if (cached) return cached;

    // Check if request is already pending (queued for this tick's batch)
    const pending = pendingRequests.current.get(key);
    if (pending) return pending;

    // Queue for the coalesced batch scheduled on the next tick. Several
    // LikeButtons mounting in the same commit are merged into ONE request.
    const request = new Promise<LikeData>((resolve) => {
      const waiters = coalesceWaiters.current.get(key) || [];
      waiters.push(resolve);
      coalesceWaiters.current.set(key, waiters);
      coalesceMeta.current.set(key, { userId, isThread });
      if (coalesceTimer.current === null) {
        coalesceTimer.current = setTimeout(() => { void flushCoalesce(); }, 0);
      }
    });

    pendingRequests.current.set(key, request);
    return request;
  }, [getLikeData, flushCoalesce]);

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
    if (coalesceTimer.current !== null) {
      clearTimeout(coalesceTimer.current);
      coalesceTimer.current = null;
    }
    // Resolve any queued waiters so their promises don't hang forever
    // (clearCache can run mid-flight, e.g. on auth change/logout).
    const now = Date.now();
    for (const [, resolvers] of coalesceWaiters.current) {
      for (const resolve of resolvers) {
        resolve({ count: 0, isLiked: false, timestamp: now });
      }
    }
    coalesceWaiters.current = new Map();
    coalesceMeta.current = new Map();
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
