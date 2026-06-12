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
  updateLikeData: (postId: string, isThread: boolean, isLiked: boolean, count: number) => void;
  clearCache: () => void;
}

const LikesCacheContext = createContext<LikesCacheContextType | undefined>(undefined);

const CACHE_TTL = 30000; // 30 seconds
const MAX_CACHE_SIZE = 200;

export const LikesCacheProvider = ({ children }: { children: ReactNode }) => {
  const [cache, setCache] = useState<Map<string, LikeData>>(new Map());
  const pendingRequests = useRef(new Map<string, Promise<LikeData>>());

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

        const promises: [Promise<{ data?: number }>, Promise<{ data?: boolean }>?] = [
          api.rpc(countFunction, {
            [isThread ? 'thread_uuid' : 'post_uuid']: postId
          })
        ];

        if (userId) {
          promises.push(
            api.rpc(hasLikedFunction, {
              [isThread ? 'thread_uuid' : 'post_uuid']: postId,
              user_uuid: userId
            })
          );
        }

        const results = await Promise.all(promises);
        const count = (results[0] as { data?: number }).data || 0;
        const isLiked = userId ? ((results[1] as { data?: boolean })?.data || false) : false;

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
  }, []);

  return (
    <LikesCacheContext.Provider value={{ getLikeData, loadLikeData, updateLikeData, clearCache }}>
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
