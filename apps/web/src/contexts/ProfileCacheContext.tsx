import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/integrations/api/compat';

interface ProfileData {
  username: string;
  color: string;
  customization: unknown;
  isAdmin: boolean;
  avatarUrl?: string;
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

  const loadProfile = useCallback(async (userId: string | undefined): Promise<ProfileData> => {
    if (!userId) {
      return { username: '', color: '', customization: null, isAdmin: false, avatarUrl: undefined };
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
        // Load all data in parallel
        const [profileRes, achievementsRes, rolesRes, customizationRes] = await Promise.all([
          api.from('profiles').select('username, avatar_url').eq('id', uid).single(),
          api.from('user_achievements').select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `).eq('user_id', uid),
          api.from('user_roles').select('role').eq('user_id', uid),
          api.from('profile_customization').select('*').eq('user_id', uid).single(),
        ]);

        // Process color from achievements
        let color = '';
        if (achievementsRes.data) {
          const colorRewards = achievementsRes.data
            .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>)?.reward_type === 'username_color')
            .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              color = p;
              break;
            }
          }
        }

        // Check if admin
        const isAdmin = rolesRes.data?.some((r: Record<string, unknown>) => r.role === 'admin') || false;

        const profileData: ProfileData = {
          username: profileRes.data?.username || '',
          color,
          customization: customizationRes.data || null,
          isAdmin,
          avatarUrl: profileRes.data?.avatar_url || undefined,
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
