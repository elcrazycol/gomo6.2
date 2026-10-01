import { api } from "@/integrations/api/compat";
import { getCached } from "@/integrations/api/queryCache";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { profileLookupUrl } from "@/utils/entityUrl";
import { registerRoutePreloader } from "@/lib/routePreload";
import type { Profile } from "./types";

/**
 * The viewer-scoped cache key Profile reads its row through. Shared so the
 * route preloader warms exactly the entry the page will hit on mount.
 */
export const profilePageCacheKey = (viewerId: string | undefined, param: string): string =>
  `profile-page:${viewerId ?? "guest"}:${param}`;

// Warm the profile row before the router swaps to the profile page, so the
// previous page stays until the profile is ready and then it paints instantly.
// The privacy/friendship reads are cheap and fill in after mount (the page
// self-corrects), so the row alone is the gate.
registerRoutePreloader(/^\/profile\/[^/]+$/, async (location) => {
  const param = location.pathname.split("/")[2];
  if (!param) return;

  const { begin, end } = useLoadingBarStore.getState();
  begin();
  try {
    const { data: { session } } = await api.auth.getSession();
    const viewerId = session?.user?.id;

    await getCached<Profile | null>(
      profilePageCacheKey(viewerId, param),
      async () => {
        const res = await fetch(profileLookupUrl(param));
        const json = await res.json();
        return (json.data?.[0] as Profile | undefined) ?? null;
      },
      { ttlMs: 60_000 },
    );
  } finally {
    end();
  }
});
