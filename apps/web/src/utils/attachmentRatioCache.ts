// Shared aspect-ratio memory for messenger attachments.
//
// Old photos carry no width/height metadata, so the first time they render we
// only know their proportions after the protected blob URL finishes loading.
// Remembering the ratio per attachment URL lets the virtualizer height
// estimate reserve the right amount of space on the next chat open — no scroll
// jump when the image re-fetches.
//
// The cache is bounded and shared across conversations; entries are small
// numbers, never file contents.

const STORAGE_KEY = "gomo6:msg-attachment-ratios";
const MAX_ENTRIES = 400;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FALLBACK_TOLERANCE = 0.05; // skip storing ratios that are basically the fallback

type CacheEntry = { ratio: number; savedAt: number };

/** The conservative placeholder ratio used while an attachment is unknown. */
export function fallbackAttachmentAspectRatio(type: "image" | "video"): number {
  return type === "video" ? 16 / 9 : 4 / 3;
}

let cached: Record<string, CacheEntry> | null = null;

// Version counter bumped on every mutation. ChatView subscribes to it so the
// virtualizer re-estimates row heights in the *current* session the moment an
// image finishes loading — not only after the chat is reopened.
let version = 0;
const listeners = new Set<() => void>();

function emitChange(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function readStorage(): Record<string, CacheEntry> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (cached && Object.keys(cached).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota). The in-memory map
    // still serves the current session, so scrolling stays stable anyway.
  }
}

function ensureLoaded(): Record<string, CacheEntry> {
  if (cached === null) {
    cached = readStorage();
    const now = Date.now();
    const keys = Object.keys(cached);
    if (keys.length > 0) {
      let expired = 0;
      for (const key of keys) {
        const entry = cached[key];
        if (
          !entry
          || typeof entry.ratio !== "number"
          || !Number.isFinite(entry.ratio)
          || entry.ratio <= 0
          || (typeof entry.savedAt === "number" && now - entry.savedAt > TTL_MS)
        ) {
          delete cached[key];
          expired += 1;
        }
      }
      if (expired > 0 && keys.length - expired === 0) persist();
    }
  }
  return cached;
}

/** Best remembered ratio for an attachment URL, or null when unknown. */
export function getAttachmentAspectRatio(url: string): number | null {
  if (!url) return null;
  const entry = ensureLoaded()[url];
  return entry && typeof entry.ratio === "number" && Number.isFinite(entry.ratio) && entry.ratio > 0
    ? entry.ratio
    : null;
}

/** Remember the measured ratio for an attachment URL. */
export function rememberAttachmentAspectRatio(
  url: string,
  ratio: number,
  fallbackRatio: number = fallbackAttachmentAspectRatio("image"),
): void {
  if (!url || !Number.isFinite(ratio) || ratio <= 0) return;
  // Ratios that match the placeholder already reserve the right amount of
  // space; storing them would only bloat localStorage.
  if (Math.abs(ratio - fallbackRatio) <= FALLBACK_TOLERANCE) return;
  const store = ensureLoaded();
  const previous = store[url];
  if (previous && Math.abs(previous.ratio - ratio) <= FALLBACK_TOLERANCE) return;
  if (!previous) {
    const keys = Object.keys(store);
    if (keys.length >= MAX_ENTRIES) {
      // Drop the oldest entry (smallest savedAt) to keep the cache bounded.
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const key of keys) {
        const at = typeof store[key]?.savedAt === "number" ? store[key].savedAt : 0;
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = key;
        }
      }
      if (oldestKey) delete store[oldestKey];
    }
  }
  store[url] = { ratio, savedAt: Date.now() };
  persist();
  emitChange();
}

/**
 * Subscribe to cache mutations. Returns an unsubscribe function. Combined with
 * `getCacheVersion` it powers the virtualizer re-estimation in the current
 * session.
 */
export function subscribeToAttachmentRatios(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic version of the cache; changes whenever a ratio is remembered. */
export function getAttachmentRatiosVersion(): number {
  return version;
}

/** Forget everything (used by tests and future cache-clear flows). */
export function clearAttachmentAspectRatios(): void {
  // Reset to null so the next access re-reads localStorage instead of serving
  // a stale in-memory snapshot (tests write storage directly between clears).
  cached = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }
}

/**
 * Test-only hook: force a fully fresh in-memory map and wipe localStorage.
 * The cache is a module singleton shared by all test files running in the same
 * vitest worker, so suites that touch it must isolate state explicitly.
 */
export function __resetAttachmentRatioCacheForTests(): void {
  cached = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }
}
