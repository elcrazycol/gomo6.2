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
      writeCached(userId, null);
      return null;
    }

    const payload = (await res.json()) as { data?: ProfileCustomization | null };
    const customization = payload?.data ?? null;
    writeCached(userId, customization);
    return customization;
  } catch (error) {
    console.error("Error loading customization:", error);
    writeCached(userId, null);
    return null;
  }
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
  } else {
    customizationCache.clear();
  }
};

/**
 * Broadcast that the current user's profile changed (username, avatar, display
 * name, nickname emoji, customization...). This is the single entry point every
 * profile mutation must call:
 *  - clears the module-level customization cache here, and
 *  - dispatches a DOM event that ProfileCacheContext and currentUserMeta
 *    listen to, so ALL client-side profile caches reset together.
 */
export const dispatchProfileCacheInvalidate = () => {
  clearCustomizationCache();
  window.dispatchEvent(new CustomEvent(PROFILE_CACHE_INVALIDATE_EVENT));
};
