import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, type ApiClientError } from "@/integrations/api/client";
import { eventManager } from "@/services/eventManager";

/** HTTP status of an apiClient failure, if any. */
export function dailyErrorStatus(err: unknown): number | undefined {
  return (err as ApiClientError | undefined)?.status;
}

export interface DailyReward {
  kind: "gems" | "drops" | "chest";
  amount?: number;
  mechanic?: string;
  chest_id?: string;
}

export interface DailyQuest {
  key: string;
  name_key: string;
  desc_key: string;
  threshold: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  can_claim: boolean;
  rewards: DailyReward[];
}

export interface DailyStreak {
  current: number;
  longest: number;
  restorable_day?: string;
  restore_price?: number;
}

export interface DailyChest {
  id: string;
  day: string;
  mechanic: string;
  created_at: string;
}

export interface DailyChestStep {
  type: "upgraded" | "failed" | "opened" | string;
  rarity: string;
  attempts_left: number;
}

export interface DailyChestOutcome {
  rarity: string;
  drops: number;
  steps?: DailyChestStep[];
}

export interface DailyRestoreResult {
  streak: number;
  price: number;
}

interface DailyProgressResponse {
  day: string;
  quests: DailyQuest[];
  unclaimed_count: number;
  full_claimed: boolean;
  streak: DailyStreak;
  chests?: DailyChest[];
  drops: number;
  /** What yesterday's settle credited just now (nil when nothing was owed). */
  auto_granted?: DailyReward[];
}

const EMPTY: DailyProgressResponse = {
  day: "",
  quests: [],
  unclaimed_count: 0,
  full_claimed: false,
  streak: { current: 0, longest: 0 },
  chests: [],
  drops: 0,
};

async function fetchDaily(): Promise<DailyProgressResponse> {
  const body = await apiClient.request<DailyProgressResponse>("/api/v1/quests/daily");
  const data = body.data as DailyProgressResponse | undefined;
  if (!data || !Array.isArray(data.quests)) return EMPTY;
  return {
    ...EMPTY,
    ...data,
    quests: data.quests,
    streak: data.streak ?? EMPTY.streak,
    chests: data.chests ?? [],
  };
}

/** localStorage key tracking whether the user has seen a given daily set. */
export function dailySeenKey(userId: string): string {
  return `daily:seen:${userId}`;
}

/**
 * Daily quests for the page: today's three, the streak, the restore offer and
 * the chest inventory. Mutations patch the local state surgically (claim,
 * restore, chest open); reload() is the initial load and the conflict
 * re-sync path. Every read settles yesterday server-side, so the first load
 * of the day may already contain auto-grants.
 */
export function useDailyQuests(userId: string | undefined) {
  const [day, setDay] = useState("");
  const [quests, setQuests] = useState<DailyQuest[]>([]);
  const [unclaimed, setUnclaimed] = useState(0);
  const [fullClaimed, setFullClaimed] = useState(false);
  const [streak, setStreak] = useState<DailyStreak>(EMPTY.streak);
  const [chests, setChests] = useState<DailyChest[]>([]);
  const [drops, setDrops] = useState(0);
  const [autoGranted, setAutoGranted] = useState<DailyReward[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));
  const firstLoad = useRef(true);
  useEffect(() => {
    firstLoad.current = true;
  }, [userId]);

  const reload = useCallback(async () => {
    if (!userId) return;
    const initial = firstLoad.current;
    if (initial) setLoading(true);
    try {
      const data = await fetchDaily();
      setDay(data.day ?? "");
      setQuests(data.quests ?? []);
      setUnclaimed(data.unclaimed_count ?? 0);
      setFullClaimed(Boolean(data.full_claimed));
      setStreak(data.streak ?? EMPTY.streak);
      setChests(data.chests ?? []);
      setDrops(data.drops ?? 0);
      setAutoGranted(data.auto_granted ?? []);
    } finally {
      if (initial) {
        firstLoad.current = false;
        setLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live updates: quest progress lands asynchronously after the user's
  // actions; the unlock toast arrives over WS at commit time. Refetch the
  // day silently on unlocks (debounced) so the page never shows stale bars.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!userId) return;
    const schedule = () => {
      if (reloadTimer.current) return;
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null;
        void reload();
      }, 700);
    };
    const off = eventManager.on("new_notification", (message) => {
      const notif = message.data as { type?: string; user_id?: string } | undefined;
      if (!notif || notif.type !== "achievement_unlock") return;
      if (notif.user_id && notif.user_id !== userId) return;
      schedule();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [userId, reload]);

  const claim = useCallback(
    async (questKey: string): Promise<DailyReward[]> => {
      const body = await apiClient.request<{ granted?: DailyReward[] }>(
        "/api/v1/quests/daily/claim",
        { method: "POST", body: JSON.stringify({ quest_key: questKey }) },
      );
      const data = body.data as { granted?: DailyReward[] } | undefined;
      return data?.granted ?? [];
    },
    [],
  );

  const restore = useCallback(async (): Promise<DailyRestoreResult> => {
    const body = await apiClient.request<DailyRestoreResult>("/api/v1/quests/daily/restore", {
      method: "POST",
    });
    const data = body.data as DailyRestoreResult | undefined;
    if (!data || typeof data.streak !== "number") throw new Error("restore failed");
    return data;
  }, []);

  const openChest = useCallback(
    async (id: string): Promise<DailyChestOutcome> => {
      const body = await apiClient.request<DailyChestOutcome>(
        `/api/v1/quests/daily/chests/${encodeURIComponent(id)}/open`,
        { method: "POST" },
      );
      const data = body.data as DailyChestOutcome | undefined;
      if (!data || typeof data.drops !== "number") throw new Error("open failed");
      return data;
    },
    [],
  );

  const applyClaim = useCallback((questKey: string, granted: DailyReward[]) => {
    setQuests((prev) =>
      prev.map((q) =>
        q.key !== questKey ? q : { ...q, claimed: true, can_claim: false },
      ),
    );
    setUnclaimed((n) => Math.max(0, n - 1));
    const dropsWon = granted
      .filter((g) => g.kind === "drops")
      .reduce((sum, g) => sum + (g.amount ?? 0), 0);
    if (dropsWon > 0) setDrops((g) => g + dropsWon);
    const chest = granted.find((g) => g.kind === "chest" && g.chest_id);
    if (chest?.chest_id) {
      const chestId = chest.chest_id;
      const mechanic = chest.mechanic || "rarity_chest";
      setChests((prev) => [
        ...prev,
        {
          id: chestId,
          day,
          mechanic,
          created_at: new Date().toISOString(),
        },
      ]);
      // The set-closing claim drops the day chest in the same response.
      setFullClaimed(true);
    }
  }, [day]);

  const applyRestore = useCallback((price: number) => {
    setDrops((g) => Math.max(0, g - price));
    setStreak((prev) => ({ ...prev, restorable_day: undefined, restore_price: undefined }));
  }, []);

  const applyChestOpen = useCallback((id: string, dropsWon: number) => {
    setChests((prev) => prev.filter((c) => c.id !== id));
    if (dropsWon > 0) setDrops((g) => g + dropsWon);
  }, []);

  return {
    day,
    quests,
    unclaimed,
    fullClaimed,
    streak,
    chests,
    drops,
    autoGranted,
    loading,
    claim,
    restore,
    openChest,
    reload,
    applyClaim,
    applyRestore,
    applyChestOpen,
  };
}
