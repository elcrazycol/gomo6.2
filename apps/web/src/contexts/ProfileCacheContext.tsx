import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/integrations/api/compat';
import { apiClient } from '@/integrations/api/client';

// Listen for external invalidation events (e.g. from CustomProfile save)
const INVALIDATE_EVENT = 'profile-cache:invalidate';

interface ProfileData {
  username: string;
  customization: unknown;
  isAdmin: boolean;
  avatarUrl?: string;
  nickname_emoji_id?: string | null;
}

interface ProfileCacheContextType {
  getProfile: (userId: string) => ProfileData | null;
  loadProfile: (userId: string | undefined) => Promise<ProfileData>;
  clearCache: () => void;
}

const ProfileCacheContext = createContext<ProfileCacheContextType | null>(null);

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of cached profiles

interface CacheEntry {
  data: ProfileData;
  timestamp: number;
  loading: Promise<ProfileData> | null;
}

export const ProfileCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cache, setCache] = useState<Map<string, CacheEntry>>(new Map());
  const loadingRequests = useRef(new Map<string, Promise<ProfileData>>());

  // Cleanup old cache entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setCache(prev => {
        const newCache = new Map(prev);
        for (const [key, entry] of newCache.entries()) {
          if (now - entry.timestamp > CACHE_TTL) {
            newCache.delete(key);
          }
        }
        return newCache;
      });
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  const getProfile = useCallback((userId: string): ProfileData | null => {
    const entry = cache.get(userId);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > CACHE_TTL) {
      setCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(userId);
        return newCache;
      });
      return null;
    }

    return entry.data;
  }, [cache]);

  const loadProfile = useCallback(async (userId: string | undefined): Promise<ProfileData> => {	    if (!userId) {
      return { username: '', customization: null, isAdmin: false, avatarUrl: undefined };
    }

    const uid = userId;

    // Check if already loading
    const existingRequest = loadingRequests.current.get(uid);
    if (existingRequest) {
      return existingRequest;
    }

    // Check cache first
    const cached = getProfile(uid);
    if (cached) {
      return cached;
    }

    // Start loading
    const loadPromise = (async () => {
      try {
        // Load all data in parallel. user_roles is a protected table (401 for
        // anonymous callers viewing a foreign profile) and single() rejects on
        // missing rows — neither may bring down the whole profile load, so
        // every request is degraded to a safe fallback.
        // The query builder's then() has a custom signature, so the run
        // closure is typed as () => unknown and the awaited result cast back.
        const toFallback = async <T,>(run: () => unknown, fallback: T): Promise<T> => {
          try {
            return (await run()) as T;
          } catch {
            return fallback;
          }
        };

        // user_roles is protected and viewer-scoped: for an anonymous caller
        // viewing a foreign profile it would 401 (the toFallback wrapper above
        // already swallows that). Guests never need the viewed profile's roles
        // — isAdmin only matters for the signed-in owner — so skip the request
        // entirely instead of firing a doomed 401.
        const isGuest = !apiClient.getCSRFToken();
        const rolesResPromise = isGuest
          ? Promise.resolve({ data: [] as { role: string }[], error: null })
          : toFallback(
              () => api.from('user_roles').select('role').eq('user_id', uid),
              { data: [], error: null }
            );		const [profileRes, rolesRes, customizationRes] = await Promise.all([
          toFallback(
            () => api.from('profiles').select('username, avatar_url, nickname_emoji_id').eq('id', uid).single(),
            { data: null, error: null }
          ),
          rolesResPromise,
          toFallback(
            () => api.from('profile_customization').select('*').eq('user_id', uid).single(),
            { data: null, error: null }
          ),
        ]);

        // Check if admin
        const isAdmin = rolesRes.data?.some((r: Record<string, unknown>) => r.role === 'admin') || false;		const profileData: ProfileData = {
          username: profileRes.data?.username || '',
          customization: customizationRes.data || null,
          isAdmin,
          avatarUrl: profileRes.data?.avatar_url || undefined,
          nickname_emoji_id: (profileRes.data as { nickname_emoji_id?: string | null } | null)?.nickname_emoji_id || null,
        };

        // Update cache
        setCache(prev => {
          const newCache = new Map(prev);

          // Limit cache size
          if (newCache.size >= MAX_CACHE_SIZE) {
            const firstKey = newCache.keys().next().value!;
            newCache.delete(firstKey);
          }

          newCache.set(uid, {
            data: profileData,
            timestamp: Date.now(),
            loading: null,
          });
          return newCache;
        });

        return profileData;
      } finally {
        loadingRequests.current.delete(uid);
      }
    })();

    loadingRequests.current.set(uid, loadPromise);
    return loadPromise;
  }, [getProfile]);

  const clearCache = useCallback(() => {
    setCache(new Map());
    loadingRequests.current.clear();
  }, []);

  // Listen for external cache invalidation events
  useEffect(() => {
    const handler = () => {
      setCache(new Map());
      loadingRequests.current.clear();
    };
    window.addEventListener(INVALIDATE_EVENT, handler);
    return () => window.removeEventListener(INVALIDATE_EVENT, handler);
  }, []);

  return (
    <ProfileCacheContext.Provider value={{ getProfile, loadProfile, clearCache }}>
      {children}
    </ProfileCacheContext.Provider>
  );
};

export const useProfileCache = () => {
  const context = useContext(ProfileCacheContext);
  if (!context) {
    throw new Error('useProfileCache must be used within ProfileCacheProvider');
  }
  return context;
};
