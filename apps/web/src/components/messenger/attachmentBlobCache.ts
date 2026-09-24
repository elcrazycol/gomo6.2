/**
 * LRU cache of authenticated attachment object URLs.
 *
 * Private (messenger) media is fetched through the storage endpoint and
 * decrypted on every request. Short clips are small, so downloading each one
 * once and keeping the object URL means re-scrolling a chat is instant and the
 * at-rest decryption happens a single time instead of per Range request.
 *
 * Entries are ref-counted: a URL currently displayed by a component is never
 * evicted, and URLs are revoked only on eviction or `clearAttachmentBlobCache`
 * (logout) — never on component unmount.
 */
const MAX_ENTRIES = 16;

type Entry = { url: string; refs: number };
const cache = new Map<string, Entry>(); // storage key → entry (oldest first)

/** The cached object URL for a key, refreshing its LRU position. */
export function getCachedAttachmentUrl(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry.url;
}

/** Store (or replace) the object URL for a key, then trim the cache. */
export function cacheAttachmentUrl(key: string, url: string): void {
  const existing = cache.get(key);
  if (existing) {
    if (existing.url !== url && existing.refs === 0) URL.revokeObjectURL(existing.url);
    cache.delete(key);
    cache.set(key, { url, refs: existing.refs });
  } else {
    cache.set(key, { url, refs: 0 });
  }
  evict();
}

/** Mark a cached URL as in use so eviction cannot revoke it mid-display. */
export function retainAttachmentUrl(key: string): void {
  const entry = cache.get(key);
  if (entry) entry.refs += 1;
}

/** Drop one use of a cached URL. */
export function releaseAttachmentUrl(key: string): void {
  const entry = cache.get(key);
  if (entry && entry.refs > 0) entry.refs -= 1;
}

function evict(): void {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    if (entry.refs > 0) continue; // still on screen — never revoke
    cache.delete(key);
    URL.revokeObjectURL(entry.url);
  }
}

/** Drop every cached object URL (call on logout / account switch). */
export function clearAttachmentBlobCache(): void {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
  cache.clear();
}

/** Test/diagnostics helper. */
export function attachmentBlobCacheSize(): number {
  return cache.size;
}
