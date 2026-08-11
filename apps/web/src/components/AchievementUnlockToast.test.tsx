import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AchievementUnlockToast,
  queueAchievementUnlock,
  advanceToastQueue,
  clearToastQueue,
  type UnlockData,
} from "./AchievementUnlockToast";

// jsdom may not provide requestAnimationFrame — stub it with a timer-based shim
// so fake-timer advancement drives the two-RAF mount animation.
const origRAF = window.requestAnimationFrame;
const origCAF = window.cancelAnimationFrame;

function stubRAF() {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 16) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) =>
    window.clearTimeout(id)) as typeof window.cancelAnimationFrame;
}

const baseAchievement: UnlockData = {
  id: "ach-1",
  name: "First Steps",
  description: "Post your first message",
  icon: "sparkles",
  rarity: "common",
};

beforeEach(() => {
  clearToastQueue();
  stubRAF();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearToastQueue();
  window.requestAnimationFrame = origRAF;
  window.cancelAnimationFrame = origCAF;
});

describe("AchievementUnlockToast", () => {
  it("renders achievement name and description", () => {
    render(<AchievementUnlockToast achievement={baseAchievement} onDismiss={vi.fn()} />);
    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.getByText("Post your first message")).toBeInTheDocument();
  });

  it("renders the rarity label for every rarity", () => {
    const cases: Array<[UnlockData["rarity"], string]> = [
      ["common", "Обычное"],
      ["uncommon", "Необычное"],
      ["rare", "Редкое"],
      ["epic", "Эпическое"],
      ["legendary", "Легендарное"],
    ];
    for (const [rarity, label] of cases) {
      const { unmount } = render(
        <AchievementUnlockToast
          achievement={{ ...baseAchievement, rarity }}
          onDismiss={vi.fn()}
        />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows 'Уровень повышен!' when prev_level is set", () => {
    render(
      <AchievementUnlockToast
        achievement={{ ...baseAchievement, prev_level: 1, max_level: 3, level: 2 }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText("Уровень повышен!")).toBeInTheDocument();
    expect(screen.queryByText("Достижение открыто!")).not.toBeInTheDocument();
  });

  it("shows 'Достижение открыто!' for a brand-new achievement", () => {
    render(<AchievementUnlockToast achievement={baseAchievement} onDismiss={vi.fn()} />);
    expect(screen.getByText("Достижение открыто!")).toBeInTheDocument();
  });

  it("renders level dots + progress bar for multi-level achievements", () => {
    render(
      <AchievementUnlockToast
        achievement={{ ...baseAchievement, max_level: 3, level: 2 }}
        onDismiss={vi.fn()}
      />
    );
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Уровень 2 из 3")).toBeInTheDocument();
  });

  it("hides level indicator for single-level achievements", () => {
    render(<AchievementUnlockToast achievement={baseAchievement} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Награда получена")).toBeInTheDocument();
  });

  it("shows 'Все уровни открыты' at max level", () => {
    render(
      <AchievementUnlockToast
        achievement={{ ...baseAchievement, max_level: 2, level: 2 }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText("Все уровни открыты")).toBeInTheDocument();
  });

  it("calls onDismiss when the close button is pressed (after exit animation)", () => {
    const onDismiss = vi.fn();
    render(<AchievementUnlockToast achievement={baseAchievement} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Закрыть"));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(450));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses after autoDismissMs", () => {
    const onDismiss = vi.fn();
    render(
      <AchievementUnlockToast
        achievement={baseAchievement}
        onDismiss={onDismiss}
        autoDismissMs={100}
      />
    );
    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(450));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire onDismiss when closed manually after auto-dismiss timer cleared", () => {
    const onDismiss = vi.fn();
    render(
      <AchievementUnlockToast
        achievement={baseAchievement}
        onDismiss={onDismiss}
        autoDismissMs={1000}
      />
    );
    fireEvent.click(screen.getByLabelText("Закрыть"));
    act(() => vi.advanceTimersByTime(2000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("toast queue manager", () => {
  it("renders immediately when the queue is idle", () => {
    const onRender = vi.fn();
    queueAchievementUnlock(baseAchievement, onRender);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledWith(baseAchievement);
  });

  it("deduplicates the achievement currently on screen (same group_key + level)", () => {
    const onRender = vi.fn();
    const withGroup = { ...baseAchievement, group_key: "group-a" };
    queueAchievementUnlock(withGroup, onRender);
    queueAchievementUnlock(withGroup, onRender);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("queues toasts while one is active and advances FIFO after dismissal", () => {
    const onRender = vi.fn();
    const first = { ...baseAchievement, id: "a1", group_key: "g1" };
    const second = { ...baseAchievement, id: "a2", group_key: "g2", name: "Second Toast" };

    queueAchievementUnlock(first, onRender);
    queueAchievementUnlock(second, onRender);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenLastCalledWith(first);

    advanceToastQueue();
    act(() => vi.advanceTimersByTime(450)); // exit animation
    act(() => vi.advanceTimersByTime(500)); // delay between toasts
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(onRender).toHaveBeenLastCalledWith(second);
  });

  it("does not enqueue an achievement that is already queued", () => {
    const onRender = vi.fn();
    const first = { ...baseAchievement, id: "a1", group_key: "g1" };
    const queued = { ...baseAchievement, id: "a2", group_key: "g2" };
    const duplicate = { ...baseAchievement, id: "a3", group_key: "g2" };

    queueAchievementUnlock(first, onRender);
    queueAchievementUnlock(queued, onRender);
    queueAchievementUnlock(duplicate, onRender); // same key as queued → ignored

    advanceToastQueue();
    act(() => vi.advanceTimersByTime(450));
    act(() => vi.advanceTimersByTime(500));
    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it("clearToastQueue resets state so the next toast renders immediately", () => {
    const onRender = vi.fn();
    queueAchievementUnlock(baseAchievement, onRender);
    clearToastQueue();
    queueAchievementUnlock({ ...baseAchievement, id: "a2" }, onRender);
    expect(onRender).toHaveBeenCalledTimes(2);
  });
});
