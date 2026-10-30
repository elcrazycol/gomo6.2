import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient, type ApiClientError } from "@/integrations/api/client";
import { eventManager } from "@/services/eventManager";

/** HTTP status of an apiClient failure, if any. */
export function questErrorStatus(err: unknown): number | undefined {
  return (err as ApiClientError | undefined)?.status;
}

export interface QuestReward {
  kind: "gems" | "drops" | "chest";
  amount?: number;
  mechanic?: string;
  chest_id?: string;
}

export interface QuestLevel {
  level: number;
  threshold: number;
  name_key: string;
  description_key: string;
  rewards: QuestReward[];
  completed: boolean;
  claimed: boolean;
  can_claim: boolean;
}

export interface Quest {
  group_key: string;
  title_key: string;
  category: string;
  track: string;
  icon: string;
  sort_order: number;
  current_level: number;
  progress_current: number;
  levels: QuestLevel[];
}

export interface QuestChest {
  id: string;
  quest_key: string;
  level: number;
  mechanic: string;
  created_at: string;
}

export interface ChestResult {
  rarity: string;
  drops: number;
}

export interface UseQuestsResult {
  quests: Quest[];
  chests: QuestChest[];
  drops: number;
  unclaimedCount: number;
  loading: boolean;
  claim: (questKey: string, level: number) => Promise<QuestReward[]>;
  openChest: (id: string) => Promise<ChestResult>;
  reload: () => Promise<void>;
  /** Patch one level as claimed without any request (after a successful claim). */
  applyClaim: (questKey: string, level: number, granted: QuestReward[]) => void;
  /** Drop an opened chest and credit its drops without any request. */
  applyChestOpen: (id: string, drops: number) => void;
}

interface ProgressResponse {
  user_id: string;
  drops: number;
  unclaimed_count: number;
  quests: Quest[];
  chests?: QuestChest[];
}

async function fetchProgress(userId: string): Promise<ProgressResponse> {
  const body = await apiClient.request<ProgressResponse>(
    `/api/v1/quests/progress?user_id=${encodeURIComponent(userId)}`,
  );
  const data = body.data as ProgressResponse | undefined;
  return data ?? { user_id: userId, drops: 0, unclaimed_count: 0, quests: [] };
}

/** Fetch raw quest progress (used by the unlock overlay to resolve names). */
export async function fetchQuestProgress(userId: string): Promise<ProgressResponse> {
  return fetchProgress(userId);
}

/**
 * Quest progress for a page: the whole catalog with completion/claim states,
 * plus claim/chest mutations. Mutations patch the local state surgically
 * (applyClaim/applyChestOpen) so the page never flashes a full loader;
 * reload() is only the initial load and the re-sync path for conflicts.
 */
export function useQuests(userId: string | undefined): UseQuestsResult {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [chests, setChests] = useState<QuestChest[]>([]);
  const [drops, setDrops] = useState(0);
  const [loading, setLoading] = useState(Boolean(userId));
  // After the first settled load, refreshes are silent background syncs.
  const firstLoad = useRef(true);
  useEffect(() => {
    firstLoad.current = true;
  }, [userId]);

  // Derived, never stale: the single source is the quests array itself.
  const unclaimedCount = useMemo(
    () => quests.reduce((n, q) => n + q.levels.filter((l) => l.can_claim).length, 0),
    [quests],
  );

  const reload = useCallback(async () => {
    if (!userId) return;
    const initial = firstLoad.current;
    if (initial) setLoading(true);
    try {
      const data = await fetchProgress(userId);
      setQuests(data.quests ?? []);
      setChests(data.chests ?? []);
      setDrops(data.drops ?? 0);
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

  // Live updates: the engine applies an unlock asynchronously after the
  // action (bounded pool), while the toast + bell arrive over WS the moment
  // it commits. Without this the open page keeps showing the pre-unlock
  // snapshot until a manual reload — the "toast says earned but the page
  // shows nothing" race. A burst of levels settles into one silent
  // background refetch; a visibility/focus refetch covers a dropped WS.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLiveReload = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void reload();
    }, 700);
  }, [reload]);

  useEffect(() => {
    if (!userId) return;
    const off = eventManager.on("new_notification", (message) => {
      const notif = message.data as { type?: string; user_id?: string } | undefined;
      if (!notif || notif.type !== "achievement_unlock") return;
      if (notif.user_id && notif.user_id !== userId) return;
      scheduleLiveReload();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleLiveReload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", scheduleLiveReload);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", scheduleLiveReload);
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [userId, scheduleLiveReload]);

  const claim = useCallback(
    async (questKey: string, level: number): Promise<QuestReward[]> => {
      const body = await apiClient.request<{ granted?: QuestReward[] }>(
        "/api/v1/quests/claim",
        { method: "POST", body: JSON.stringify({ quest_key: questKey, level }) },
      );
      const data = body.data as { granted?: QuestReward[] } | undefined;
      return data?.granted ?? [];
    },
    [],
  );

  const openChest = useCallback(
    async (id: string): Promise<ChestResult> => {
      const body = await apiClient.request<ChestResult>(
        `/api/v1/quests/chests/${encodeURIComponent(id)}/open`,
        { method: "POST" },
      );
      const data = body.data as ChestResult | undefined;
      if (!data) throw new Error("open failed");
      return data;
    },
    [],
  );

  const applyClaim = useCallback(
    (questKey: string, level: number, granted: QuestReward[]) => {
      setQuests((prev) =>
        prev.map((q) =>
          q.group_key !== questKey
            ? q
            : {
                ...q,
                levels: q.levels.map((l) =>
                  l.level !== level ? l : { ...l, claimed: true, can_claim: false },
                ),
              },
        ),
      );
      const dropsWon = granted
        .filter((g) => g.kind === "drops")
        .reduce((sum, g) => sum + (g.amount ?? 0), 0);
      if (dropsWon > 0) setDrops((g) => g + dropsWon);
      const chestsWon = granted.filter((g) => g.kind === "chest" && g.chest_id);
      if (chestsWon.length > 0) {
        setChests((prev) => [
          ...prev,
          ...chestsWon.map((g) => ({
            id: g.chest_id as string,
            quest_key: questKey,
            level,
            mechanic: g.mechanic || "rarity_chest",
            created_at: new Date().toISOString(),
          })),
        ]);
      }
    },
    [],
  );

  const applyChestOpen = useCallback((id: string, dropsWon: number) => {
    setChests((prev) => prev.filter((c) => c.id !== id));
    if (dropsWon > 0) setDrops((g) => g + dropsWon);
  }, []);

  return {
    quests,
    chests,
    drops,
    unclaimedCount,
    loading,
    claim,
    openChest,
    reload,
    applyClaim,
    applyChestOpen,
  };
}
