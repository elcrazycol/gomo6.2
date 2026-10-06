import { getCached } from "@/integrations/api/queryCache";
import { registerRouteData } from "@/lib/routeData";
import { isPublicId, profileLookupUrl } from "@/utils/entityUrl";
import type { AchievementLevel } from "@/components/AchievementCard";

export interface AchievementRow {
  id: string;
  group_key?: string;
  title?: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  rarity?: string;
  achievement_type?: string;
  hidden?: boolean;
  sort_order?: number;
  levels?: AchievementLevel[];
}

export interface AchievementsProfileRow {
  username: string;
  avatar_url?: string | null;
  id: string;
}

export const ACHIEVEMENTS_CATALOG_KEY = "achievements-page:catalog";
export const achievementsProfileKey = (param: string): string => `achievements-page:profile:${param}`;
export const achievementsUserKey = (uid: string): string => `achievements-page:user:${uid}`;

/**
 * The profile row is resolved first: the route parameter may be a public
 * number, and user_achievements.user_id is a UUID column.
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

export const loadAchievementsUser = (uid: string): Promise<Record<string, unknown>[]> =>
  getCached<Record<string, unknown>[]>(
    achievementsUserKey(uid),
    async () => {
      const res = await fetch(`/api/v1/user_achievements?user_id=eq.${uid}`);
      const json = await res.json();
      return (json.data || []) as Record<string, unknown>[];
    },
    // Short freshness: unlocks arrive via WS, which dispatches
    // profile-cache:invalidate → clearQueryCache, so the page refreshes
    // immediately on unlock even with a longer TTL. The stale window keeps the
    // last list visible while the revalidation runs.
    { ttlMs: 30_000, staleTtlMs: 5 * 60_000 },
  );

export const loadAchievementsCatalog = (): Promise<AchievementRow[]> =>
  getCached<AchievementRow[]>(
    ACHIEVEMENTS_CATALOG_KEY,
    async () => {
      const res = await fetch(`/api/v1/achievements?order=sort_order.asc`);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        return (json.data || []) as AchievementRow[];
      } catch {
        console.error("Failed to parse achievements catalog:", text.slice(0, 200));
        return [];
      }
    },
    // The catalog only changes on deploy (Sync mirrors it at startup), so a
    // long freshness is safe; the stale window is larger still.
    { ttlMs: 5 * 60_000, staleTtlMs: 60 * 60_000 },
  );

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
      await Promise.all([
        uid ? loadAchievementsUser(uid) : Promise.resolve([]),
        loadAchievementsCatalog(),
      ]);
    },
  });
}
