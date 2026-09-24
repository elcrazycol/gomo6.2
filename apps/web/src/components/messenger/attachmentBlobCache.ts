/**
 * LRU cache of authenticated attachment object URLs, with single-flight loads.
 *
 * Private (messenger) media is fetched through the storage endpoint and
 * decrypted on every request. Short clips are small, so downloading each one
 * once and keeping the object URL means re-scrolling a chat is instant and the
 * at-rest decryption happens a single time.
 *
 * The cache is bounded by BOTH entry count and total bytes: 16 large videos
 * would otherwise hold hundreds of MB in the tab and mobile browsers would kill
 * it. Clips larger than `MAX_ENTRY_BYTES` are held only while on screen
 * (transient) and released as soon as nothing displays them.
 *
 * Entries are ref-counted, so a URL currently on screen is never evicted.
 * Object URLs are revoked only on eviction, transient release, or
 * `clearAttachmentBlobCache` (sign-out) — never on component unmount.
 */
const MAX_ENTRIES = 32;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

type Entry = { url: string; refs: number; bytes: number; transient: boolean };
const cache = new Map<string, Entry>(); // storage key → entry (oldest first)
let totalBytes = 0;

/** The cached object URL for a key, refreshing its LRU position. */
export function getCachedAttachmentUrl(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry.url;
}

/** Store (or refresh) the object URL for a key, then trim the cache. */
export function cacheAttachmentUrl(key: string, url: string, bytes: number): void {
  const existing = cache.get(key);
  if (existing && existing.url === url) {
    existing.bytes = bytes;
    existing.transient = bytes > MAX_ENTRY_BYTES;
    return;
  }
  if (existing) {
    cache.delete(key);
    totalBytes -= existing.bytes;
    if (existing.refs === 0) URL.revokeObjectURL(existing.url);
  }
  cache.set(key, { url, refs: 0, bytes, transient: bytes > MAX_ENTRY_BYTES });
  totalBytes += bytes;
  evict();
}

/** Mark a cached URL as in use so eviction cannot revoke it mid-display. */
export function retainAttachmentUrl(key: string): void {
  const entry = cache.get(key);
  if (entry) entry.refs += 1;
}

/** Drop one use of a cached URL; a released transient entry is revoked now. */
export function releaseAttachmentUrl(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  if (entry.refs > 0) entry.refs -= 1;
  if (entry.refs === 0 && entry.transient) {
    cache.delete(key);
    totalBytes -= entry.bytes;
    URL.revokeObjectURL(entry.url);
  }
}

function evict(): void {
  if (totalBytes <= MAX_TOTAL_BYTES && cache.size <= MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (totalBytes <= MAX_TOTAL_BYTES && cache.size <= MAX_ENTRIES) break;
    if (entry.refs > 0) continue; // still on screen — never revoke
    cache.delete(key);
    totalBytes -= entry.bytes;
    URL.revokeObjectURL(entry.url);
  }
}

/** Drop every cached object URL (call on logout / account switch). */
export function clearAttachmentBlobCache(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
  totalBytes = 0;
}

// ─── Single-flight ───────────────────────────────────────────────────────────
// Two components asking for the same key (list preview + lightbox) must share
// one fetch, so the at-rest decryption runs once. The load is aborted only when
// the last waiter goes away.

type Loader = (signal: AbortSignal) => Promise<{ url: string; bytes: number } | null>;
type Flight = { promise: Promise<string | null>; waiters: number; controller: AbortController };
const flights = new Map<string, Flight>();

export function getOrLoadAttachmentUrl(
  key: string,
  loader: Loader,
): { promise: Promise<string | null>; release: () => void } {
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const created: Flight = { promise: Promise.resolve(null), waiters: 0, controller };
    created.promise = (async () => {
      const result = await loader(controller.signal);
      if (!result) return null;
      cacheAttachmentUrl(key, result.url, result.bytes);
      // The flight holds one ref for all its waiters; released when the last
      // one goes away, so a transient (large) entry is revoked at the right
      // time and never evicted while still on screen.
      if (created.waiters > 0) retainAttachmentUrl(key);
      return result.url;
    })();
    void created.promise.catch(() => {});
    created.promise.finally(() => {
      if (flights.get(key) === created) flights.delete(key);
    });
    flight = created;
    flights.set(key, flight);
  }

  flight.waiters += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const current = flight as Flight;
    current.waiters -= 1;
    if (current.waiters <= 0) {
      current.controller.abort();
      releaseAttachmentUrl(key);
      if (flights.get(key) === current) flights.delete(key);
    }
  };

  return { promise: flight.promise, release };
}

/** Test/diagnostics helpers. */
export function attachmentBlobCacheSize(): number {
  return cache.size;
}

export function attachmentBlobCacheBytes(): number {
  return totalBytes;
}
