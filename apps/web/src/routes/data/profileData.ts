import { api } from "@/integrations/api/compat";
import { getCached } from "@/integrations/api/queryCache";
import { registerRouteData } from "@/lib/routeData";
import { profileLookupUrl } from "@/utils/entityUrl";
import type { Profile } from "@/pages/profile/types";

/**
 * The viewer-scoped cache key Profile reads its row through. Shared so the
 * route preloader warms exactly the entry the page will hit on mount.
 */
export const profilePageCacheKey = (viewerId: string | undefined, param: string): string =>
  `profile-page:${viewerId ?? "guest"}:${param}`;

/** Fetch a profile row by UUID or public id. Shared by the page + preloader. */
export const fetchProfilePageRow = async (param: string): Promise<Profile | null> => {
  const res = await fetch(profileLookupUrl(param));
  const json = await res.json();
  return (json.data?.[0] as Profile | undefined) ?? null;
};

/** Warm the profile row through the same viewer-scoped key the page reads. */
export const warmProfilePageRow = async (viewerId: string | undefined, param: string): Promise<Profile | null> =>
  getCached<Profile | null>(
    profilePageCacheKey(viewerId, param),
    () => fetchProfilePageRow(param),
    // Fresh for a minute, then served stale (instantly) for up to five more
    // while a background revalidation runs — so back-navigation never blocks.
    { ttlMs: 60_000, staleTtlMs: 5 * 60_000 },
  );

export function registerProfileRouteData(): void {
  registerRouteData({
    id: "profile",
    match: "/profile/:userId",
    // Warm the profile row before the router swaps to the profile page, so the
    // previous page stays until the profile is ready and then it paints
    // instantly. Privacy/friendship reads are cheap and fill in after mount
    // (the page self-corrects), so the row alone is the gate.
    warm: async ({ location }) => {
      const param = location.pathname.split("/")[2];
      if (!param) return;

      const { data: { session } } = await api.auth.getSession();
      const viewerId = session?.user?.id;
      await warmProfilePageRow(viewerId, param);
    },
  });
}
