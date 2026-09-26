import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCached, invalidateByPrefix } from "@/integrations/api/queryCache";
import {
  buildTrophies,
  mapUserAchievementRaw,
  mapUserAwardRaw,
  type AchievementData,
  type Trophy,
  type UserAchievementRaw,
  type UserAward,
  type UserAwardRaw,
} from "@/utils/trophies";

/** Short TTL: unlocks arrive over WS, which clears the query cache anyway. */
const TROPHIES_TTL_MS = 30_000;

export interface UseTrophiesOptions {
  /** Defer the fetch until true (the profile loads on tab open). */
  enabled?: boolean;
}

export interface UseTrophiesResult {
  /** Unlocked auto milestones. */
  milestones: AchievementData[];
  /** Active hand-granted awards. */
  awards: UserAward[];
  /** Milestones + awards merged, rarest first. */
  trophies: Trophy[];
  loading: boolean;
  /** True once a fetch for the current user has settled. */
  loaded: boolean;
  /** Drop the cache and refetch (used after an unlock/WS invalidation). */
  reload: () => Promise<void>;
}

/**
 * Fetch a user's trophies — `user_achievements` and `user_awards` in parallel —
 * and normalize them into one rarest-first list. Both endpoints enforce the
 * achievements privacy rule server-side, so an unauthorized visitor simply gets
 * an empty list.
 */
export function useTrophies(
  userId: string | undefined,
  options: UseTrophiesOptions = {},
): UseTrophiesResult {
  const { enabled = true } = options;
  const [milestones, setMilestones] = useState<AchievementData[]>([]);
  const [awards, setAwards] = useState<UserAward[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Which user the current data belongs to; prevents a stale render from a
  // previous profile being treated as loaded for the next one.
  const loadedFor = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!userId) {
      setMilestones([]);
      setAwards([]);
      setLoaded(true);
      return;
    }
    setLoading(true);
    try {
      const [achRows, awardRows] = await Promise.all([
        getCached<UserAchievementRaw[]>(
          `trophies:achievements:${userId}`,
          async () => {
            const res = await fetch(
              `/api/v1/user_achievements?user_id=eq.${userId}&order=current_level.desc&order=unlocked_at.desc`,
            );
            const json = await res.json();
            return (json.data || []) as UserAchievementRaw[];
          },
          { ttlMs: TROPHIES_TTL_MS },
        ),
        getCached<UserAwardRaw[]>(
          `trophies:awards:${userId}`,
          async () => {
            const res = await fetch(
              `/api/v1/user_awards?user_id=eq.${userId}&order=awarded_at.desc`,
            );
            const json = await res.json();
            return (json.data || []) as UserAwardRaw[];
          },
          { ttlMs: TROPHIES_TTL_MS },
        ),
      ]);
      setMilestones(achRows.map(mapUserAchievementRaw));
      setAwards(awardRows.map(mapUserAwardRaw));
    } catch (error) {
      // Guests or transient failures must never surface as unhandled
      // rejections — the surface just renders without trophies.
      console.error("Error loading trophies:", error);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [userId]);

  // Reset immediately when the target user changes so the previous profile's
  // trophies never flash on the next one.
  useEffect(() => {
    loadedFor.current = undefined;
    setMilestones([]);
    setAwards([]);
    setLoaded(false);
  }, [userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    void load();
  }, [enabled, userId, load]);

  const reload = useCallback(async () => {
    if (!userId) return;
    invalidateByPrefix(`trophies:achievements:${userId}`);
    invalidateByPrefix(`trophies:awards:${userId}`);
    loadedFor.current = userId;
    await load();
  }, [userId, load]);

  const trophies = useMemo(() => buildTrophies(milestones, awards), [milestones, awards]);

  return { milestones, awards, trophies, loading, loaded, reload };
}
