import { PROFILE_CACHE_INVALIDATE_EVENT } from "@/utils/profileCacheEvents";

export interface ProfileCustomization {
  username_css: string | null;
  profile_badge_text: string | null;
  profile_badge_css: string | null;
  background_url: string | null;
}

const CUSTOMIZATION_TTL = 5 * 60 * 1000;
const CUSTOMIZATION_MAX_ENTRIES = 200;

interface CacheEntry {
  value: ProfileCustomization | null;
  at: number;
}

const customizationCache = new Map<string, CacheEntry>();

// In-flight requests keyed by user id. The cache above is only populated once a
// response resolves, so without this a feed rendering N badges for the same
// author fired N identical concurrent requests on a cold load. They all share
// the first promise instead.
const inFlight = new Map<string, Promise<ProfileCustomization | null>>();

// Bumped on every invalidation. A request captures the generation before it
// starts and only writes its result if the generation is unchanged, so a
// response that resolves after an edit can never resurrect the stale entry.
let globalGeneration = 0;
const userGeneration = new Map<string, number>();

const generationFor = (userId: string): string =>
  `${globalGeneration}:${userGeneration.get(userId) ?? 0}`;

const readCached = (userId: string): { hit: boolean; value: ProfileCustomization | null } => {
  const entry = customizationCache.get(userId);
  if (!entry) return { hit: false, value: null };
  // Expired entries are dropped rather than served. Without a TTL a viewer who
  // once saw a nickname kept the old colour forever: the invalidate event only
  // fires in the editor's own browser, so other clients would never hear about
  // the change.
  if (Date.now() - entry.at > CUSTOMIZATION_TTL) {
    customizationCache.delete(userId);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
};

const writeCached = (userId: string, value: ProfileCustomization | null) => {
  if (!customizationCache.has(userId) && customizationCache.size >= CUSTOMIZATION_MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = customizationCache.keys().next().value;
    if (oldest !== undefined) customizationCache.delete(oldest);
  }
  customizationCache.set(userId, { value, at: Date.now() });
};

export const getProfileCustomization = async (userId: string): Promise<ProfileCustomization | null> => {
  const cached = readCached(userId);
  if (cached.hit) {
    return cached.value;
  }

  // A concurrent call for the same user is already on the wire — reuse it
  // instead of firing a duplicate (the cache is written only on resolution).
  const pending = inFlight.get(userId);
  if (pending) {
    return pending;
  }

  const generation = generationFor(userId);

  const promise = (async (): Promise<ProfileCustomization | null> => {
    try {
      // Public display endpoint, NOT the generic /profile_customization surface:
      // that table is read-scoped to the caller's own user_id
      // (TableMeta.UserScopedRead), so querying it with somebody else's id returns
      // an empty row — which is exactly why nobody ever saw another user's
      // nickname colour. /users/:id/customization serves the display fields to any
      // viewer (the same reason /users/:id/privacy exists for privacy_settings)
      // and it works for the current user too, so no owner/viewer branch is needed.
      const res = await fetch(`/api/v1/users/${encodeURIComponent(userId)}/customization`);
      if (!res.ok) {
        if (generationFor(userId) === generation) writeCached(userId, null);
        return null;
      }

      const payload = (await res.json()) as { data?: ProfileCustomization | null };
      const customization = payload?.data ?? null;
      // An invalidation that landed while this request was in flight wins: do
      // not overwrite the cleared cache with the pre-edit response.
      if (generationFor(userId) === generation) writeCached(userId, customization);
      return customization;
    } catch (error) {
      console.error("Error loading customization:", error);
      if (generationFor(userId) === generation) writeCached(userId, null);
      return null;
    } finally {
      inFlight.delete(userId);
    }
  })();

  inFlight.set(userId, promise);
  return promise;
};

export const parseCssToStyle = (css: string): React.CSSProperties => {
  const style: React.CSSProperties = {};
  
  if (!css) return style;

  const declarations = css.split(';').filter(s => s.trim());
  
  declarations.forEach(decl => {
    // Split on first colon only, as values may contain colons (e.g., url(...), rgba(...))
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) return;
    
    const property = decl.substring(0, colonIndex).trim();
    const value = decl.substring(colonIndex + 1).trim();
    
    if (!property || !value) return;

    // Convert CSS property to React style property
    const reactProperty = property
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      .replace(/^webkit/, 'Webkit')
      .replace(/^moz/, 'Moz')
      .replace(/^ms/, 'Ms');

    // Handle special cases
    if (reactProperty === 'webkitBackgroundClip') {
      style.WebkitBackgroundClip = value as string;
    } else if (reactProperty === 'webkitTextFillColor') {
      style.WebkitTextFillColor = value as string;
    } else if (reactProperty === 'background') {
      style.background = value;
    } else if (reactProperty === 'backgroundImage') {
      style.backgroundImage = value;
    } else if (reactProperty === 'backgroundColor') {
      style.backgroundColor = value;
    } else if (reactProperty === 'color') {
      style.color = value;
    } else if (reactProperty === 'textShadow') {
      style.textShadow = value;
    } else if (reactProperty === 'boxShadow') {
      style.boxShadow = value;
    } else if (reactProperty === 'borderRadius') {
      style.borderRadius = value;
    } else {
      (style as Record<string, string | undefined>)[reactProperty] = value;
    }
  });

  return style;
};

export const clearCustomizationCache = (userId?: string) => {
  if (userId) {
    customizationCache.delete(userId);
    inFlight.delete(userId);
    userGeneration.set(userId, (userGeneration.get(userId) ?? 0) + 1);
    return;
  }
  customizationCache.clear();
  inFlight.clear();
  globalGeneration += 1;
};

/**
 * Broadcast that a profile changed (username, avatar, display name, nickname
 * emoji, customization...). This is the single entry point every profile
 * mutation must call:
 *  - clears the relevant customization cache entry, and
 *  - dispatches a DOM event that ProfileCacheContext, currentUserMeta and the
 *    other client-side profile caches listen to, so they reset together.
 *
 * Pass `userId` to scope the invalidation to one profile (the server sends it
 * with every profile_updated broadcast). Listeners that only hold that user's
 * data then skip their refetch, so one person editing their nickname no longer
 * makes every viewer re-fetch every mounted badge. Omitting it keeps the old
 * whole-cache reset, which the editor's own save still wants.
 */
export const dispatchProfileCacheInvalidate = (userId?: string) => {
  clearCustomizationCache(userId);
  window.dispatchEvent(new CustomEvent(PROFILE_CACHE_INVALIDATE_EVENT, { detail: { userId } }));
};
