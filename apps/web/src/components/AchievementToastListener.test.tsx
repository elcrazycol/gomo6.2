import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AchievementToastListener } from "./AchievementToastListener";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockQueue, mockAdvance } = vi.hoisted(() => ({
  mockQueue: vi.fn(),
  mockAdvance: vi.fn(),
}));

vi.mock("@/components/AchievementUnlockToast", () => ({
  AchievementUnlockToast: ({ achievement, onDismiss }: any) => (
    <div>
      <span>{achievement.name}</span>
      <button onClick={onDismiss}>Закрыть</button>
    </div>
  ),
  queueAchievementUnlock: mockQueue,
  advanceToastQueue: mockAdvance,
}));

// The store object is re-mutated in beforeEach; the factory reads it lazily at
// render time (inside the selector), so the deferred binding is safe.
const mockStore: Record<string, unknown> = {
  lastUnlockedAchievement: null,
  clearAchievement: vi.fn(),
  markAsRead: vi.fn(),
};

vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (selector: any) => selector(mockStore),
}));

function makeAchievement(notificationId: string) {
  return {
    notification_id: notificationId,
    id: "ach1",
    group_key: "g1",
    name: "First Steps",
    description: "Post your first message",
    icon: "sparkles",
    rarity: "common",
    level: 1,
    max_level: 1,
    is_first_time: true,
    prev_level: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.lastUnlockedAchievement = null;
  mockStore.markAsRead = vi.fn();
  mockStore.clearAchievement = vi.fn();
  // Real queueAchievementUnlock calls onRender synchronously when idle
  mockQueue.mockImplementation((data: any, onRender: any) => onRender(data));
});

describe("AchievementToastListener", () => {
  it("renders nothing when there is no unlocked achievement", () => {
    render(<AchievementToastListener />);
    expect(mockQueue).not.toHaveBeenCalled();
    expect(screen.queryByText("First Steps")).not.toBeInTheDocument();
  });

  it("queues the achievement and renders the toast when a new one arrives", async () => {
    mockStore.lastUnlockedAchievement = makeAchievement("n1");
    render(<AchievementToastListener />);

    await waitFor(() => {
      expect(screen.getByText("First Steps")).toBeInTheDocument();
    });

    expect(mockQueue).toHaveBeenCalledTimes(1);
    const [data, onRender] = mockQueue.mock.calls[0];
    expect(data).toMatchObject({
      id: "ach1",
      name: "First Steps",
      rarity: "common",
      notification_id: "n1",
    });
    expect(typeof onRender).toBe("function");
    // Marks as read once + clears the pending achievement from the store
    expect(mockStore.markAsRead).toHaveBeenCalledWith("n1");
    expect(mockStore.clearAchievement).toHaveBeenCalled();
  });

  it("does not re-queue the same notification twice (dedup by notification_id)", async () => {
    mockStore.lastUnlockedAchievement = makeAchievement("n2");
    const first = render(<AchievementToastListener />);
    await waitFor(() => expect(screen.getByText("First Steps")).toBeInTheDocument());
    expect(mockQueue).toHaveBeenCalledTimes(1);
    first.unmount();

    // Simulate the same notification arriving again (new object identity, same id)
    mockStore.lastUnlockedAchievement = makeAchievement("n2");
    const second = render(<AchievementToastListener />);

    await waitFor(() => {
      expect(mockStore.clearAchievement).toHaveBeenCalledTimes(2);
    });
    // The duplicate must NOT be queued again (shownNotificationIds dedup)
    expect(mockQueue).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("dismisses the toast and advances the queue", async () => {
    mockStore.lastUnlockedAchievement = makeAchievement("n3");
    render(<AchievementToastListener />);

    await waitFor(() => {
      expect(screen.getByText("First Steps")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(mockAdvance).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("First Steps")).not.toBeInTheDocument();
  });

  it("clears a stale achievement whose notification was already shown", async () => {
    // Show n4 once so its id lands in shownNotificationIds
    mockStore.lastUnlockedAchievement = makeAchievement("n4");
    const first = render(<AchievementToastListener />);
    await waitFor(() => expect(screen.getByText("First Steps")).toBeInTheDocument());
    first.unmount();
    expect(mockQueue).toHaveBeenCalledTimes(1);

    // Now n4 shows up again (e.g., store repopulated after navigation)
    mockStore.lastUnlockedAchievement = makeAchievement("n4");
    render(<AchievementToastListener />);

    await waitFor(() => {
      // Stale entry cleared without re-queuing
      expect(mockStore.clearAchievement).toHaveBeenCalledTimes(2);
    });
    expect(mockQueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("First Steps")).not.toBeInTheDocument();
  });
});
