import { api } from "@/integrations/api/compat";
import type { GiftCatalogItem } from "@/components/GiftCard";

/**
 * TTL-cached metadata for the current user (roles, username, avatar) and the
 * public gift catalog.
 *
 * Every page (Profile, Thread, Index, Board...) used to fetch user_roles +
 * profiles on mount just to know the moderator/admin flags — one navigation
 * fired the same requests per page. This collapses them into a single batched
 * call cached for 5 minutes, so a page-to-page hop costs 0 requests.
 *
 * The cache is cleared on the same 'profile-cache:invalidate' DOM event that
 * clears ProfileCacheContext, so saving a profile/avatar is reflected on the
 * next load instead of serving stale data for 5 minutes.
 */

export interface CurrentUserMeta {
  roles: string[];
  color: string;
  username: string;
  avatarUrl?: string;
  /** Custom nickname emoji shown next to the display name (nickname_emoji_id). */
  nicknameEmojiId?: string | null;
}

const TTL = 5 * 60 * 1000; // 5 minutes
const EMPTY: CurrentUserMeta = { roles: [], color: "", username: "" };

interface CacheEntry {
  expiresAt: number;
  value: CurrentUserMeta;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CurrentUserMeta>>();export function clearCurrentUserMetaCache() {
  cache.clear();
  inFlight.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("profile-cache:invalidate", clearCurrentUserMetaCache);
}

async function fetchCurrentUserMeta(userId: string): Promise<CurrentUserMeta> {
  const token = (await api.auth.getSession()).data.session?.access_token;
  const headers: Record<string, string> | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;	const [rolesRes, profileRes] = await Promise.all([
    fetch(`/api/v1/user_roles?user_id=eq.${userId}`, { headers }),
    fetch(`/api/v1/profiles?id=eq.${userId}`, { headers }),
  ]);

  const [rolesJson, profileJson] = await Promise.all([
    rolesRes.json().catch(() => ({ data: [] })),
    profileRes.json().catch(() => ({ data: [] })),
  ]);

  const roles: string[] = Array.isArray(rolesJson?.data)
    ? rolesJson.data.map((r: { role?: string }) => r.role).filter(Boolean)
    : [];	const profile = profileJson?.data?.[0] ?? null;

  // username_color achievement rewards were removed — no nickname color.
  return {
    roles,
    color: "",
    username: profile?.username ?? "",
    avatarUrl: profile?.avatar_url ?? undefined,
    nicknameEmojiId: profile?.nickname_emoji_id ?? null,
  };
}

export async function getCurrentUserMeta(userId: string | undefined): Promise<CurrentUserMeta> {
  if (!userId) return EMPTY;

  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.value;

  const existing = inFlight.get(userId);
  if (existing) return existing;

  const promise = (async (): Promise<CurrentUserMeta> => {
    try {
      const value = await fetchCurrentUserMeta(userId);
      cache.set(userId, { expiresAt: Date.now() + TTL, value });
      return value;
    } catch {
      // Network/5xx failure: degrade to empty meta WITHOUT caching it, so the
      // next call retries. Never let a page crash because cached metadata
      // (roles/color) failed to load.
      return EMPTY;
    } finally {
      inFlight.delete(userId);
    }
  })();

  inFlight.set(userId, promise);
  return promise;
}

// ─── Gift catalog (public, rarely changes) ──────────────────────────────────

const GIFT_CATALOG_TTL = 10 * 60 * 1000; // 10 minutes
let giftCatalogCache: { expiresAt: number; value: GiftCatalogItem[] } | null = null;
let giftCatalogInFlight: Promise<GiftCatalogItem[]> | null = null;

export async function getGiftCatalog(): Promise<GiftCatalogItem[]> {
  if (giftCatalogCache && giftCatalogCache.expiresAt > Date.now()) {
    return giftCatalogCache.value;
  }
  if (giftCatalogInFlight) return giftCatalogInFlight;

  giftCatalogInFlight = (async () => {
    try {
      const res = await fetch("/api/v1/gift_catalog");
      const json = await res.json().catch(() => ({ data: [] }));
      const items = (json.data ?? []) as GiftCatalogItem[];
      giftCatalogCache = { expiresAt: Date.now() + GIFT_CATALOG_TTL, value: items };
      return items;
    } finally {
      giftCatalogInFlight = null;
    }
  })();

  return giftCatalogInFlight;
}
