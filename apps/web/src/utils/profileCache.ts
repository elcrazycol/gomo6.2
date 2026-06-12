// Simple in-memory cache for profile data
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class ProfileCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly TTL = 60000; // 1 minute cache

  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if cache is still valid
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}

export const profileCache = new ProfileCache();
