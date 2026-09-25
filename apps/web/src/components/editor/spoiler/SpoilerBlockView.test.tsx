import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpoilerBlockView } from "./SpoilerBlockView";

describe("SpoilerBlockView", () => {
  it("blurs the content until the reader reveals it", () => {
    const { container } = render(
      <SpoilerBlockView label="Спойлер к серии">
        <p>секрет</p>
      </SpoilerBlockView>,
    );

    expect(screen.getByText("Спойлер к серии")).toBeInTheDocument();
    expect(screen.getByText("Показать")).toBeInTheDocument();
    const body = container.querySelector(".spoiler-block__body");
    expect(body).not.toBeNull();
    expect(body?.className).toContain("spoiler-block__body--hidden");
    expect(body).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Скрыть")).toBeInTheDocument();
    const revealed = container.querySelector(".spoiler-block__body");
    expect(revealed?.className).not.toContain("spoiler-block__body--hidden");
    expect(revealed).toHaveAttribute("aria-hidden", "false");
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
