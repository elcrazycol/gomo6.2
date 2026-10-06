import { getCached } from "@/integrations/api/queryCache";
import { registerRouteData } from "@/lib/routeData";
import { isPublicId, profileLookupUrl } from "@/utils/entityUrl";
import type { UserAchievementRaw, UserAwardRaw } from "@/utils/trophies";

/** Short freshness: unlocks arrive over WS, which clears the query cache. */
const TROPHIES_TTL_MS = 30_000;

export interface AchievementsProfileRow {
  username: string;
  avatar_url?: string | null;
  id: string;
}

export const achievementsProfileKey = (param: string): string => `achievements-page:profile:${param}`;

/**
 * The profile row is resolved first: the route parameter may be a public
 * number, while `user_achievements.user_id` / `user_awards.user_id` are UUID
 * columns.
 */
export const loadAchievementsProfile = (param: string): Promise<AchievementsProfileRow | null> =>
  getCached<AchievementsProfileRow | null>(
    achievementsProfileKey(param),
    async () => {
      const res = await fetch(profileLookupUrl(param));
      const json = await res.json();
      return (json.data?.[0] as AchievementsProfileRow | undefined) ?? null;
    },
    { ttlMs: 60_000, staleTtlMs: 5 * 60_000 },
  );

/**
 * Warm the exact cache entries `useTrophies` reads (same keys, same shape) so
 * the trophy hall paints instantly after a prefetch. The endpoints enforce the
 * achievements privacy rule server-side, so guest prefetches simply return [].
 */
export const loadAchievementsTrophies = (uid: string): Promise<[UserAchievementRaw[], UserAwardRaw[]]> =>
  Promise.all([
    getCached<UserAchievementRaw[]>(
      `trophies:achievements:${uid}`,
      async () => {
        const res = await fetch(
          `/api/v1/user_achievements?user_id=eq.${uid}&order=current_level.desc&order=unlocked_at.desc`,
        );
        const json = await res.json();
        return (json.data || []) as UserAchievementRaw[];
      },
      { ttlMs: TROPHIES_TTL_MS },
    ),
    getCached<UserAwardRaw[]>(
      `trophies:awards:${uid}`,
      async () => {
        const res = await fetch(`/api/v1/user_awards?user_id=eq.${uid}&order=awarded_at.desc`);
        const json = await res.json();
        return (json.data || []) as UserAwardRaw[];
      },
      { ttlMs: TROPHIES_TTL_MS },
    ),
  ]);

export function registerAchievementsRouteData(): void {
  registerRouteData({
    id: "achievements",
    match: "/achievements/:userId",
    warm: async ({ params }) => {
      const param = params.userId;
      if (!param) return;
      const profile = await loadAchievementsProfile(param);
      // A numeric parameter is only resolvable through the profile row above.
      const uid = profile?.id ?? (isPublicId(param) ? "" : param);
      if (uid) await loadAchievementsTrophies(uid);
    },
  });
}
