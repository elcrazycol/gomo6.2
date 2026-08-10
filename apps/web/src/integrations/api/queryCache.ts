// Thin TTL cache for api.from() GET requests.
//
// Every component used to fire the same GET (e.g. profiles?id=eq.X, boards)
// on mount, on hover, and on navigation — the backend rate-limiter then
// returned 429s while the frontend kept hammering. This cache sits in the
// single choke point (executeQuery in query-builder.ts), so ANY api.from()
// GET is deduplicated app-wide for a short TTL and invalidated on writes.
//
// Rules:
//  - only successful responses are cached (errors are never stored)
//  - parallel identical GETs share one in-flight promise (no thundering herd)
//  - returned values are deep-cloned so component mutations never poison the cache
//  - write operations (POST/PUT/DELETE) invalidate the affected table prefix

const DEFAULT_TTL_MS = 30_000; // 30s — matches the server-side wall cache TTL

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

const clone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
};

interface GetOptions<T> {
  ttlMs?: number;
  /** Return false to skip caching this value (e.g. errored responses). */
  shouldCache?: (value: T) => boolean;
}

/**
 * Returns the cached value for `key` or fetches it via `fetcher`, caching the
 * result for `ttlMs` (default 30s). Identical concurrent calls share a single
 * in-flight request. The resolved value is always a deep clone.
 */
export function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: GetOptions<T> = {},
): Promise<T> {
  const { ttlMs = DEFAULT_TTL_MS, shouldCache } = opts;

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return Promise.resolve(clone(hit.value) as T);
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async (): Promise<T> => {
    try {
      const value = await fetcher();
      if (!shouldCache || shouldCache(value)) {
        // Store a clone so later caller mutations never corrupt the entry.
        cache.set(key, { expiresAt: Date.now() + ttlMs, value: clone(value) });
      }
      // Always return a clone — including the very first caller — so that
      // mutating the result cannot poison the cached copy.
      return clone(value);
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Evicts every cached entry whose key starts with `prefix`. */
export function invalidateByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Drops the whole cache (test teardown, auth switches). */
export function clearQueryCache(): void {
  cache.clear();
  inflight.clear();
}

// Profile saves, avatar changes and auth switches broadcast this event; the
// GET cache must follow suit so stale user-scoped rows are never served.
if (typeof window !== "undefined") {
  window.addEventListener("profile-cache:invalidate", clearQueryCache);
}
