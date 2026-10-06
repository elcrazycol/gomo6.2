// Thin SWR cache for api.from() GET requests.
//
// Every component used to fire the same GET (e.g. profiles?id=eq.X, boards)
// on mount, on hover, and on navigation — the backend rate-limiter then
// returned 429s while the frontend kept hammering. This cache sits in the
// single choke point (executeQuery in query-builder.ts), so ANY api.from()
// GET is deduplicated app-wide and invalidated on writes.
//
// Stale-while-revalidate: an entry is FRESH for `ttlMs`, then STALE for a
// further `staleTtlMs`. A fresh hit is returned as-is. A stale hit is returned
// immediately AND revalidated in the background; subscribers (see
// `subscribe` / `useCachedQuery`) get the fresh value when it lands. Past
// `expiresAt` the entry is gone and the next read blocks on a fetch.
//
// Rules:
//  - only successful responses are cached (errors are never stored)
//  - parallel identical GETs share one in-flight promise (no thundering herd)
//  - returned values are deep-cloned so component mutations never poison the cache
//  - write operations (POST/PUT/DELETE) invalidate the affected table prefix

const DEFAULT_TTL_MS = 30_000; // 30s — matches the server-side wall cache TTL

interface CacheEntry {
  value: unknown;
  /** Serve as-is until this time; no revalidation. */
  freshUntil: number;
  /** Hard eviction: past this there is nothing to serve. */
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();

const clone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
};

interface GetOptions<T> {
  /** Freshness window in ms (default 30s). */
  ttlMs?: number;
  /**
   * Extra retention past freshness during which the old value is served while
   * a background revalidation runs. Defaults to 0 — the pre-SWR behaviour
   * (a miss the moment the freshness window closes).
   */
  staleTtlMs?: number;
  /** Return false to skip caching this value (e.g. errored responses). */
  shouldCache?: (value: T) => boolean;
}

export type { GetOptions };

const notify = (key: string): void => {
  const set = listeners.get(key);
  if (set) for (const listener of set) listener();
};

/**
 * Subscribe to updates for `key` — fired after a background revalidation or an
 * invalidation. Returns an unsubscribe function.
 */
export function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

function store<T>(
  key: string,
  value: T,
  ttlMs: number,
  staleTtlMs: number,
  shouldCache?: (value: T) => boolean,
): void {
  if (shouldCache && !shouldCache(value)) return;
  const now = Date.now();
  const freshFor = Math.max(0, ttlMs);
  cache.set(key, {
    // Store a clone so later caller mutations never corrupt the entry.
    value: clone(value),
    freshUntil: now + freshFor,
    expiresAt: now + freshFor + Math.max(0, staleTtlMs),
  });
  notify(key);
}

function runFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
  staleTtlMs: number,
  shouldCache?: (value: T) => boolean,
): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async (): Promise<T> => {
    try {
      const value = await fetcher();
      store(key, value, ttlMs, staleTtlMs, shouldCache);
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

/**
 * Returns the value for `key` or fetches it via `fetcher`.
 *
 *  - fresh  → the cached value, no request
 *  - stale  → the cached value immediately + a background revalidation
 *  - miss   → the fetched value (identical concurrent calls share one request)
 *
 * The resolved value is always a deep clone.
 */
export function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: GetOptions<T> = {},
): Promise<T> {
  const { ttlMs = DEFAULT_TTL_MS, staleTtlMs = 0, shouldCache } = opts;

  const now = Date.now();
  const hit = cache.get(key);

  if (hit && hit.freshUntil > now) {
    return Promise.resolve(clone(hit.value) as T);
  }

  if (hit && hit.expiresAt > now) {
    // Stale-while-revalidate. `runFetch` dedupes with any in-flight request
    // and notifies subscribers when the fresh value lands; a failed
    // revalidation keeps the stale entry and never surfaces.
    void runFetch(key, fetcher, ttlMs, staleTtlMs, shouldCache).catch(() => {});
    return Promise.resolve(clone(hit.value) as T);
  }

  return runFetch(key, fetcher, ttlMs, staleTtlMs, shouldCache);
}

/**
 * Reads a cached value synchronously, without triggering a fetch.
 *
 * Used by pages that want to paint warm data on the very first render (e.g. a
 * route preloader already warmed the key): `useState(() => peekCached(key))`.
 * Returns `undefined` for a miss or a hard-expired entry — never blocks, never
 * fetches. Stale (still-retained) values are returned. The value is a clone.
 */
export function peekCached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return undefined;
  return clone(hit.value as T);
}

/** Evicts every cached entry whose key starts with `prefix`. */
export function invalidateByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      notify(key);
    }
  }
}

/** Drops the whole cache (test teardown, auth switches). */
export function clearQueryCache(): void {
  // Clear BEFORE notifying, so a subscriber that reacts by peeking sees the
  // empty state and re-fetches instead of re-reading the dropped value.
  const keys = [...cache.keys()];
  cache.clear();
  inflight.clear();
  for (const key of keys) notify(key);
}

// Profile saves, avatar changes and auth switches broadcast this event; the
// GET cache must follow suit so stale user-scoped rows are never served.
if (typeof window !== "undefined") {
  window.addEventListener("profile-cache:invalidate", clearQueryCache);
}
