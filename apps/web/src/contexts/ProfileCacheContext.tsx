import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/integrations/api/compat';
import { apiClient } from '@/integrations/api/client';
import { isPublicId } from "@/utils/entityUrl";
import { getProfileCustomization } from "@/utils/profileCustomization";
import { profileCacheInvalidateUserId } from "@/utils/profileCacheEvents";

// Listen for external invalidation events (e.g. from CustomProfile save)
const INVALIDATE_EVENT = 'profile-cache:invalidate';

interface ProfileData {
  /** Canonical user id (uuid) the row was resolved to. */
  id?: string;
  username: string;
  customization: unknown;
  isAdmin: boolean;
  avatarUrl?: string;
  nickname_emoji_id?: string | null;
  /** Public number of the viewed profile, for /profile/<n> links. */
  public_id?: number | null;
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
        // `uid` may be a public number (new links) or a UUID (old ones): the
        // profiles query accepts both, and the row's canonical id is what the
        // other lookups (user_roles, customization) must use.
        const profileRes = await toFallback(
          () =>
            api
              .from('profiles')
              .select('id, public_id, username, avatar_url, nickname_emoji_id')
              .eq(isPublicId(uid) ? 'public_id' : 'id', uid)
              .single(),
          { data: null, error: null }
        );
        const resolvedId = (profileRes.data as { id?: string } | null)?.id || uid;

        const isGuest = !apiClient.getCSRFToken();
        const [rolesRes, customization] = await Promise.all([
          isGuest
            ? Promise.resolve({ data: [] as { role: string }[], error: null })
            : toFallback(
                () => api.from('user_roles').select('role').eq('user_id', resolvedId),
                { data: [], error: null }
              ),
          // Profile appearance for the viewed user, read through the SHARED
          // profileCustomization cache (module-level, with in-flight dedupe).
          // UserBadge's useProfileCustomization reads the same cache, so a badge
          // that already fetched this user's appearance does not trigger a
          // second identical request here — which used to double the
          // /users/:id/customization volume. NOT the generic
          // /profile_customization surface: that table is read-scoped to the
          // caller's own user_id (TableMeta.UserScopedRead), so a foreign
          // profile always came back empty. The public display endpoint works
          // for the owner too, so no branch is needed.
          getProfileCustomization(resolvedId),
        ]);

        // Check if admin
        const isAdmin = rolesRes.data?.some((r: Record<string, unknown>) => r.role === 'admin') || false;		const profileData: ProfileData = {
          id: resolvedId,
          username: profileRes.data?.username || '',
          customization: customization || null,
          isAdmin,
          avatarUrl: profileRes.data?.avatar_url || undefined,
          nickname_emoji_id: (profileRes.data as { nickname_emoji_id?: string | null } | null)?.nickname_emoji_id || null,
          public_id: (profileRes.data as { public_id?: number | null } | null)?.public_id ?? null,
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
    const handler = (event: Event) => {
      const changedUserId = profileCacheInvalidateUserId(event);

      // Unscoped reset (the editor's own save): drop everything.
      if (!changedUserId) {
        setCache(new Map());
        loadingRequests.current.clear();
        return;
      }

      // Scoped reset (the server's profile_updated broadcast): only the
      // affected user's entry is stale. Match the key it was requested under
      // (uuid or public id) as well as the resolved canonical id.
      setCache(prev => {
        let next: Map<string, CacheEntry> | null = null;
        for (const [key, entry] of prev) {
          if (key === changedUserId || entry.data.id === changedUserId) {
            next ??= new Map(prev);
            next.delete(key);
          }
        }
        return next ?? prev;
      });
      loadingRequests.current.delete(changedUserId);
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
