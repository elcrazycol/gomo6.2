// localStorage cache for the custom emoji system.
//
// Custom emojis are resolved lazily by id, and subscribed packs are fetched
// from the server on mount. On a cold load that meant the first paint had no
// emoji records at all, so inline emojis flashed placeholders until the
// network round-trip finished. This cache seeds the EmojiDataContext
// synchronously from localStorage, so a returning visitor sees every emoji
// immediately and the network refresh replaces the data in the background.
//
// The cache is keyed by user id: subscriptions are per-user, so the packs of
// one account are never served to another. Emoji records themselves are
// public content and are kept regardless (posts embed emoji ids).

import type { EmojiData, EmojiPackData } from '@/contexts/EmojiDataContext';

const STORAGE_KEY = 'gomo6-emoji-cache:v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — stale is fine, refresh replaces it
const MAX_CACHED_EMOJIS = 2000;
const MAX_CACHED_PACKS = 50;

export interface EmojiCacheData {
  version: 1;
  /** Owner of the subscribed packs. `null` for guests (kept emojis only). */
  userId: string | null;
  /** Every known emoji record: from resolved ids AND from pack emojis. */
  emojis: Record<string, EmojiData>;
  /** Subscribed + owned packs, with their emojis, for the picker grids. */
  packs: EmojiPackData[];
  subscribedPackIds: string[];
  ownedPackIds: string[];
  savedAt: number;
}

function isEmojiData(value: unknown): value is EmojiData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.image_url === 'string' && typeof v.pack_id === 'string';
}

function isPackData(value: unknown): value is EmojiPackData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.slug === 'string';
}

/** Reads and validates the cached emoji data, or null when absent/corrupt. */
export function loadEmojiCache(): EmojiCacheData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EmojiCacheData>;
    if (parsed.version !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;

    const emojis: Record<string, EmojiData> = {};
    if (parsed.emojis && typeof parsed.emojis === 'object') {
      for (const [id, value] of Object.entries(parsed.emojis)) {
        if (isEmojiData(value) && value.id === id) emojis[id] = value;
      }
    }
    // Sanitize packs: keep only well-formed records with valid emojis arrays.
    const packs: EmojiPackData[] = [];
    if (Array.isArray(parsed.packs)) {
      for (const pack of parsed.packs) {
        if (!isPackData(pack)) continue;
        const emojisList = Array.isArray(pack.emojis)
          ? pack.emojis.filter(isEmojiData)
          : [];
        packs.push({ ...pack, emojis: emojisList });
      }
    }
    const subscribedPackIds = Array.isArray(parsed.subscribedPackIds)
      ? parsed.subscribedPackIds.filter((id): id is string => typeof id === 'string')
      : [];
    const ownedPackIds = Array.isArray(parsed.ownedPackIds)
      ? parsed.ownedPackIds.filter((id): id is string => typeof id === 'string')
      : [];

    return {
      version: 1,
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      emojis,
      packs,
      subscribedPackIds,
      ownedPackIds,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/** Persists the cache. Failures (quota, private mode) are silently ignored. */
export function saveEmojiCache(cache: EmojiCacheData): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep the stored payload bounded: oldest entries are dropped first.
    const entries = Object.entries(cache.emojis);
    const emojis = entries.length > MAX_CACHED_EMOJIS
      ? Object.fromEntries(entries.slice(entries.length - MAX_CACHED_EMOJIS))
      : cache.emojis;
    const packs = cache.packs.length > MAX_CACHED_PACKS
      ? cache.packs.slice(cache.packs.length - MAX_CACHED_PACKS)
      : cache.packs;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cache, emojis, packs }));
  } catch {
    // localStorage unavailable (private mode, quota) — caching is best-effort.
  }
}

/** Drops the cache entirely (test teardown, logout). */
export function clearEmojiCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
