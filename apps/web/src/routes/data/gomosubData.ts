import { getCached } from "@/integrations/api/queryCache";
import { registerRouteData } from "@/lib/routeData";

export type GomoSub = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cover_image_url?: string | null;
  created_at: string;
};

/**
 * Explicit cache key (the GET URL) so the page can read through `useCachedQuery`
 * and the route preloader can warm the exact same entry. Writes to `boards`
 * invalidate it via the generic `/api/v1/boards` prefix.
 */
export const GOMOSUBS_LIST_KEY =
  "/api/v1/boards?is_gomosub=eq.true&visibility=eq.public&order=created_at.desc&select=id,slug,name,description,cover_image_url,created_at,visibility";

export const GOMOSUBS_TTL_MS = 5 * 60 * 1000;
export const GOMOSUBS_STALE_MS = 30 * 60 * 1000;

export const fetchPublicGomoSubs = async (): Promise<GomoSub[]> => {
  const res = await fetch(GOMOSUBS_LIST_KEY);
  const json = await res.json();
  return (json.data as GomoSub[]) ?? [];
};

export const loadPublicGomoSubs = (): Promise<GomoSub[]> =>
  getCached(GOMOSUBS_LIST_KEY, fetchPublicGomoSubs, {
    ttlMs: GOMOSUBS_TTL_MS,
    staleTtlMs: GOMOSUBS_STALE_MS,
  });

export function registerGomoSubRouteData(): void {
  registerRouteData({
    id: "gomosubs",
    match: ["/gomosubs", "/g"],
    warm: async () => {
      await loadPublicGomoSubs();
    },
  });
}
