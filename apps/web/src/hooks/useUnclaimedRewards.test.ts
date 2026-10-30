import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { refreshUnclaimedCount, unclaimedKey } from "@/hooks/useUnclaimedRewards";
import { clearQueryCache } from "@/integrations/api/queryCache";

const mockRequest = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: (...args: unknown[]) => mockRequest(...args) },
}));
vi.mock("@/services/eventManager", () => ({
  eventManager: { on: vi.fn(() => () => {}) },
}));

import { useUnclaimedCount } from "@/hooks/useUnclaimedRewards";

const progress = (unclaimed: number | undefined, canClaimLevels: number[]) => ({
  success: true,
  data: {
    user_id: "u1",
    drops: 0,
    ...(unclaimed === undefined ? {} : { unclaimed_count: unclaimed }),
    quests: [
      {
        group_key: "q",
        title_key: "t",
        category: "c",
        track: "main",
        icon: "i",
        sort_order: 1,
        current_level: 0,
        progress_current: 0,
        levels: canClaimLevels.map((level) => ({
          level,
          threshold: 1,
          name_key: "n",
          description_key: "d",
          rewards: [],
          completed: true,
          claimed: false,
          can_claim: true,
        })),
      },
    ],
  },
});

describe("useUnclaimedCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryCache();
  });

  it("reads the server unclaimed_count", async () => {
    mockRequest.mockResolvedValue(progress(3, [1]));
    const { result } = renderHook(() => useUnclaimedCount("u1"));
    await waitFor(() => expect(result.current).toBe(3));
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/quests/progress?user_id=u1"),
    );
  });

  it("derives the count from levels when the server omits it", async () => {
    mockRequest.mockResolvedValue(progress(undefined, [1, 2]));
    const { result } = renderHook(() => useUnclaimedCount("u1"));
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("fetches nothing for guests", () => {
    const { result } = renderHook(() => useUnclaimedCount(undefined));
    expect(result.current).toBe(0);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("refreshes every reader after a claim", async () => {
    mockRequest.mockResolvedValueOnce(progress(2, [1]));
    const { result } = renderHook(() => useUnclaimedCount("u1"));
    await waitFor(() => expect(result.current).toBe(2));

    mockRequest.mockResolvedValueOnce(progress(0, []));
    await act(async () => {
      refreshUnclaimedCount("u1");
    });
    await waitFor(() => expect(result.current).toBe(0));
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("uses a stable key per user", () => {
    expect(unclaimedKey("u1")).toBe("quests:unclaimed:u1");
  });
});
