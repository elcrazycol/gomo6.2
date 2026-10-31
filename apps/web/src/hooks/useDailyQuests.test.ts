import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDailyQuests } from "./useDailyQuests";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const DAILY = {
  day: "2026-10-31",
  quests: [
    {
      key: "daily_likes",
      name_key: "achievements.daily.daily_likes.name",
      desc_key: "achievements.daily.daily_likes.description",
      threshold: 5,
      progress: 5,
      completed: true,
      claimed: false,
      can_claim: true,
      rewards: [{ kind: "drops", amount: 10 }],
    },
    {
      key: "daily_comments",
      name_key: "achievements.daily.daily_comments.name",
      desc_key: "achievements.daily.daily_comments.description",
      threshold: 2,
      progress: 1,
      completed: false,
      claimed: false,
      can_claim: false,
      rewards: [{ kind: "drops", amount: 12 }],
    },
  ],
  unclaimed_count: 1,
  full_claimed: false,
  streak: { current: 3, longest: 7 },
  chests: [],
  drops: 100,
};

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ success: true, data }),
    text: () => Promise.resolve(JSON.stringify({ success: true, data })),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(() => Promise.resolve(ok(DAILY)));
});

describe("useDailyQuests", () => {
  it("loads the day once", async () => {
    const { result } = renderHook(() => useDailyQuests("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.day).toBe("2026-10-31");
    expect(result.current.quests).toHaveLength(2);
    expect(result.current.unclaimed).toBe(1);
    expect(result.current.streak.current).toBe(3);
    expect(result.current.drops).toBe(100);
    expect(mockFetch.mock.calls.filter(([u]) => String(u).includes("/quests/daily")).length).toBe(1);
  });

  it("applyClaim seals the quest and adds drops without refetching", async () => {
    const { result } = renderHook(() => useDailyQuests("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockClear();

    act(() => {
      result.current.applyClaim("daily_likes", [{ kind: "drops", amount: 10 }]);
    });

    const q = result.current.quests.find((x) => x.key === "daily_likes");
    expect(q?.claimed).toBe(true);
    expect(q?.can_claim).toBe(false);
    expect(result.current.unclaimed).toBe(0);
    expect(result.current.drops).toBe(110);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("applyClaim with a chest opens the vault and closes the day", async () => {
    const { result } = renderHook(() => useDailyQuests("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.applyClaim("daily_likes", [{ kind: "chest", chest_id: "c1", mechanic: "rarity_chest" }]);
    });

    expect(result.current.chests).toHaveLength(1);
    expect(result.current.chests[0].id).toBe("c1");
    expect(result.current.fullClaimed).toBe(true);
  });

  it("applyRestore clears the offer and subtracts the price", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(ok({ ...DAILY, streak: { current: 4, longest: 9, restorable_day: "2026-10-30", restore_price: 80 } })),
    );
    const { result } = renderHook(() => useDailyQuests("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.streak.restorable_day).toBe("2026-10-30");

    act(() => {
      result.current.applyRestore(80);
    });

    expect(result.current.streak.restorable_day).toBeUndefined();
    expect(result.current.drops).toBe(20);
    expect(mockFetch.mock.calls.filter(([u]) => String(u).includes("/quests/daily/restore")).length).toBe(0);
  });

  it("exposes yesterday's auto-grant for the one-time toast", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        ok({
          ...DAILY,
          auto_granted: [
            { kind: "drops", amount: 40 },
            { kind: "chest", chest_id: "c9" },
          ],
        }),
      ),
    );
    const { result } = renderHook(() => useDailyQuests("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoGranted).toHaveLength(2);
  });

  it("applyChestOpen drops the chest and adds drops without refetching", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(ok({ ...DAILY, chests: [{ id: "c9", day: "2026-10-31", mechanic: "rarity_chest", created_at: "" }] })),
    );
    const { result } = renderHook(() => useDailyQuests("u1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockClear();

    act(() => {
      result.current.applyChestOpen("c9", 40);
    });

    expect(result.current.chests).toHaveLength(0);
    expect(result.current.drops).toBe(140);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
