import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TrophyShowcase } from "./TrophyShowcase";
import type { AchievementData } from "./AchievementCard";

function makeAchievement(overrides: Partial<AchievementData> = {}): AchievementData {
  return {
    id: "ach-1",
    name: "Achievement",
    description: "",
    icon: "sparkles",
    category: "content",
    rarity: "common",
    level: 1,
    ...overrides,
  };
}

describe("TrophyShowcase", () => {
  it("renders nothing when no achievement has artwork", () => {
    const { container } = render(
      <TrophyShowcase achievements={[makeAchievement({ id: "a", group_key: "comments" })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only achievements that have artwork", () => {
    render(
      <TrophyShowcase
        achievements={[
          makeAchievement({ id: "a", group_key: "likes_received", name: "Замеченный" }),
          makeAchievement({ id: "b", group_key: "comments", name: "Комментарии" }),
        ]}
      />,
    );

    expect(screen.getByAltText("Замеченный")).toBeInTheDocument();
    expect(screen.queryByAltText("Комментарии")).not.toBeInTheDocument();
  });

  it("hides locked trophies", () => {
    render(
      <TrophyShowcase
        achievements={[
          makeAchievement({
            id: "a",
            group_key: "likes_received",
            name: "Замеченный",
            locked: true,
          }),
        ]}
      />,
    );

    expect(screen.queryByAltText("Замеченный")).not.toBeInTheDocument();
  });

  it("orders trophies rarest first", () => {
    render(
      <TrophyShowcase
        achievements={[
          makeAchievement({ id: "a", group_key: "bio", name: "О себе", rarity: "common" }),
          makeAchievement({
            id: "b",
            group_key: "likes_received",
            name: "Замеченный",
            rarity: "legendary",
          }),
        ]}
      />,
    );

    const names = screen.getAllByRole("img").map((el) => el.getAttribute("alt"));
    expect(names).toEqual(["Замеченный", "О себе"]);
  });
});
