import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpoilerBlockView } from "./SpoilerBlockView";

describe("SpoilerBlockView", () => {
  it("collapses the content and animates it open", () => {
    const { container } = render(
      <SpoilerBlockView label="Спойлер к серии">
        <p>секрет</p>
      </SpoilerBlockView>,
    );

    expect(screen.getByText("Спойлер к серии")).toBeInTheDocument();
    expect(screen.getByText("Показать")).toBeInTheDocument();
    const reveal = container.querySelector("[data-spoiler-reveal]");
    expect(reveal).not.toBeNull();
    // Collapsed: the grid row is 0fr, so the body takes no height.
    expect(reveal?.className).toContain("grid-rows-[0fr]");
    expect(reveal?.querySelector("[aria-hidden='true']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Скрыть")).toBeInTheDocument();
    const opened = container.querySelector("[data-spoiler-reveal]");
    expect(opened?.className).toContain("grid-rows-[1fr]");
    expect(opened?.className).not.toContain("grid-rows-[0fr]");
    expect(opened?.querySelector("[aria-hidden='false']")).not.toBeNull();
  });

  it("falls back to the default label", () => {
    render(
      <SpoilerBlockView label="">
        <p>контент</p>
      </SpoilerBlockView>,
    );
    expect(screen.getByText("Спойлер")).toBeInTheDocument();
  });
});
