import { useEffect } from "react";

import { useCachedQuery } from "@/hooks/useCachedQuery";
import { fetchQuestProgress } from "@/hooks/useQuests";
import { invalidateByPrefix } from "@/integrations/api/queryCache";
import { eventManager } from "@/services/eventManager";

/** Shared cache key so the header badge and the sidebar row read one fetch. */
export const unclaimedKey = (userId: string) => `quests:unclaimed:${userId}`;

async function fetchUnclaimedCount(userId: string): Promise<number> {
  const data = await fetchQuestProgress(userId);
  if (typeof data.unclaimed_count === "number") return data.unclaimed_count;
  return (data.quests ?? []).reduce(
    (n, q) => n + (q.levels ?? []).filter((l) => l.can_claim).length,
    0,
  );
}

/**
 * How many quest rewards are waiting for a claim. Served stale-while-revalidate
 * (30s TTL) and refreshed live: an achievement_unlock for this user drops the
 * entry so the badge appears within a second, and claim pages push
 * refreshUnclaimedCount() after they settle.
 */
export function useUnclaimedCount(userId: string | undefined): number {
  const { data } = useCachedQuery<number>(
    userId ? unclaimedKey(userId) : "quests:unclaimed:guest",
    () => fetchUnclaimedCount(userId as string),
    { enabled: !!userId, ttlMs: 30_000 },
  );

  useEffect(() => {
    if (!userId) return;
    const off = eventManager.on("new_notification", (message) => {
      const notif = message.data as { type?: string; user_id?: string } | undefined;
      if (!notif || notif.type !== "achievement_unlock") return;
      if (notif.user_id && notif.user_id !== userId) return;
      invalidateByPrefix(unclaimedKey(userId));
    });
    return off;
  }, [userId]);

  return data ?? 0;
}

/** Drop the badge entry so every reader refetches at once (call after claim). */
export function refreshUnclaimedCount(userId: string | undefined): void {
  if (!userId) return;
  invalidateByPrefix(unclaimedKey(userId));
}
