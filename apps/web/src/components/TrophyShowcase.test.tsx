import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TrophyShowcase } from "./TrophyShowcase";
import type { Trophy } from "@/utils/trophies";

function makeTrophy(overrides: Partial<Trophy> = {}): Trophy {
  return {
    key: "a:1",
    kind: "milestone",
    groupKey: "likes_received",
    icon: "heart",
    artUrl: "/trophies/likes_received-1.png",
    level: 1,
    maxLevel: 1,
    name: "Любимец",
    description: "",
    ownerShare: 3,
    tier: "legendary",
    ...overrides,
  };
}

describe("TrophyShowcase", () => {
  it("renders nothing when there are no trophies", () => {
    const { container } = render(<TrophyShowcase trophies={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders trophies in the given (rarest-first) order", () => {
    render(
      <TrophyShowcase
        trophies={[
          makeTrophy({ key: "a:1", name: "Идол", artUrl: "/trophies/likes_received-2.png" }),
          makeTrophy({ key: "a:2", name: "Любимец" }),
        ]}
      />,
    );

    const alts = screen.getAllByRole("img").map((el) => el.getAttribute("alt"));
    expect(alts).toEqual(["Идол", "Любимец"]);
  });

  it("caps the case to the limit", () => {
    render(
      <TrophyShowcase
        limit={1}
        trophies={[makeTrophy({ name: "Первый" }), makeTrophy({ key: "a:2", name: "Второй" })]}
      />,
    );

    expect(screen.getByAltText("Первый")).toBeInTheDocument();
    expect(screen.queryByAltText("Второй")).not.toBeInTheDocument();
  });

  it("includes hand-granted awards", () => {
    render(
      <TrophyShowcase
        trophies={[
          makeTrophy({
            key: "w:1",
            kind: "award",
            groupKey: "award_bughunter",
            name: "Баг-хантер",
            artUrl: null,
          }),
        ]}
      />,
    );

    // No art: the name renders as text next to the icon.
    expect(screen.getByText("Баг-хантер")).toBeInTheDocument();
  });
});
