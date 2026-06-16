import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AchievementCard, type AchievementData } from "./AchievementCard";

vi.mock("@/components/AchievementIcons", () => ({
  getAchievementIcon: () => ({ size, className }: { size?: number; className?: string }) => (
    <span data-testid="achievement-icon" className={className} style={{ fontSize: size }} />
  ),
  IconSparkles: () => <span data-testid="sparkles-icon" />,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

function makeAchievement(overrides: Partial<AchievementData> = {}): AchievementData {
  return {
    id: "ach-1",
    name: "First Steps",
    description: "Complete your first post",
    icon: "star",
    category: "engagement",
    rarity: "common",
    ...overrides,
  };
}

describe("AchievementCard", () => {
  it("renders unlocked achievement with name and description", () => {
    render(<AchievementCard achievement={makeAchievement()} />);
    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.getByText("Complete your first post")).toBeInTheDocument();
  });

  it("renders rarity badge for unlocked achievement", () => {
    render(<AchievementCard achievement={makeAchievement({ rarity: "epic" })} />);
    expect(screen.getByText("Эпическое")).toBeInTheDocument();
  });

  it("renders locked achievement with muted style", () => {
    render(<AchievementCard achievement={makeAchievement({ locked: true })} />);
    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.getByText("Complete your first post")).toBeInTheDocument();
  });

  it("renders hidden (secret) achievement with reveal prompt", () => {
    render(<AchievementCard achievement={makeAchievement({ locked: true, hidden: true })} />);
    expect(screen.getByText("Секретное достижение")).toBeInTheDocument();
    expect(screen.getByText("Нажми, чтобы раскрыть")).toBeInTheDocument();
  });

  it("reveals hidden achievement on click", async () => {
    const user = userEvent.setup();
    render(<AchievementCard achievement={makeAchievement({ locked: true, hidden: true })} />);

    await user.click(screen.getByText("Секретное достижение"));

    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.queryByText("Секретное достижение")).not.toBeInTheDocument();
  });

  it("shows level badge when current_level > 1", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({
          level: 3,
          max_level: 5,
          levels: [
            { level: 1, threshold: 10, name: "Level 1", description: "Desc 1", rarity: "common" },
            { level: 2, threshold: 25, name: "Level 2", description: "Desc 2", rarity: "uncommon" },
            { level: 3, threshold: 50, name: "Level 3", description: "Desc 3", rarity: "rare" },
          ],
        })}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("shows progress bar when levels exist and not maxed", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({
          level: 1,
          max_level: 3,
          progress_current: 15,
          levels: [
            { level: 1, threshold: 10, name: "Level 1", description: "Desc 1", rarity: "common" },
            { level: 2, threshold: 25, name: "Level 2", description: "Desc 2", rarity: "uncommon" },
          ],
        })}
      />,
    );
    expect(screen.getByText("15 / 25 → ур. 2")).toBeInTheDocument();
  });

  it("shows level dots for multi-level achievements", () => {
    const { container } = render(
      <AchievementCard
        achievement={makeAchievement({
          level: 2,
          max_level: 4,
          levels: [
            { level: 1, threshold: 10, name: "L1", description: "D1", rarity: "common" },
            { level: 2, threshold: 25, name: "L2", description: "D2", rarity: "uncommon" },
            { level: 3, threshold: 50, name: "L3", description: "D3", rarity: "rare" },
            { level: 4, threshold: 100, name: "L4", description: "D4", rarity: "epic" },
          ],
        })}
      />,
    );
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots.length).toBeGreaterThanOrEqual(4);
  });

  it("shows garma reward string", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({
          level: 1,
          levels: [
            { level: 1, threshold: 10, name: "L1", description: "D1", rarity: "common", reward_type: "garma", reward_value: "50" },
          ],
        })}
      />,
    );
    expect(screen.getByText("+50 gармы")).toBeInTheDocument();
  });

  it("shows username color reward string", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({
          level: 1,
          levels: [
            { level: 1, threshold: 10, name: "L1", description: "D1", rarity: "common", reward_type: "username_color", reward_value: "purple" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Цвет ника: purple")).toBeInTheDocument();
  });

  it("shows unlock date", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({ unlocked_at: "2025-06-15T12:00:00Z" })}
      />,
    );
    expect(screen.getByText(/15.*июня.*2025/)).toBeInTheDocument();
  });

  it("does not show unlock date in compact mode", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({ unlocked_at: "2025-06-15T12:00:00Z" })}
        compact
      />,
    );
    expect(screen.queryByText(/15.*июня/)).not.toBeInTheDocument();
  });

  it("shows pin button in editing mode and calls onTogglePin", async () => {
    const onTogglePin = vi.fn();
    const user = userEvent.setup();
    render(
      <AchievementCard
        achievement={makeAchievement()}
        isEditing
        onTogglePin={onTogglePin}
      />,
    );

    const pinBtn = screen.getByTitle("Закрепить");
    await user.click(pinBtn);
    expect(onTogglePin).toHaveBeenCalledWith("ach-1");
  });

  it("shows unpin button for pinned achievement in editing mode", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({ is_pinned: true })}
        isEditing
        onTogglePin={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Открепить")).toBeInTheDocument();
  });

  it("shows trophy icon for pinned achievement when not editing", () => {
    const { container } = render(
      <AchievementCard achievement={makeAchievement({ is_pinned: true })} />,
    );
    expect(container.querySelector(".text-amber-400\\/60")).toBeInTheDocument();
  });

  it("shows progress bar for locked achievement with threshold", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({
          locked: true,
          progress_current: 5,
          levels: [
            { level: 1, threshold: 10, name: "L1", description: "D1", rarity: "common" },
          ],
        })}
      />,
    );
    expect(screen.getByText("5 / 10")).toBeInTheDocument();
  });

  it("uses level name for unlocked multi-level achievement", () => {
    render(
      <AchievementCard
        achievement={makeAchievement({
          level: 2,
          levels: [
            { level: 1, threshold: 10, name: "初级", description: "初级描述", rarity: "common" },
            { level: 2, threshold: 25, name: "中级", description: "中级描述", rarity: "uncommon" },
          ],
        })}
      />,
    );
    expect(screen.getByText("中级")).toBeInTheDocument();
    expect(screen.getByText("中级描述")).toBeInTheDocument();
  });

  it("applies compact classes", () => {
    const { container } = render(
      <AchievementCard achievement={makeAchievement()} compact />,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("p-3");
  });
});
