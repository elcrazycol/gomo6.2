import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";

import { HeaderIconButton, HeaderIconLink, HeaderIconVisual } from "@/components/HeaderIconButton";

describe("HeaderIconButton", () => {
  it("renders an action button with the label and ink marker", () => {
    render(
      <HeaderIconButton label="Поиск">
        <span>lens</span>
      </HeaderIconButton>,
    );
    const button = screen.getByRole("button", { name: "Поиск" });
    expect(button).toBeInTheDocument();
    expect(button.querySelector("[data-ink]")).not.toBeNull();
    // No active route dot without active.
    expect(button.querySelector(".bg-primary.rounded-full")).toBeNull();
  });

  it("parks the active dot and primary tint when active", () => {
    render(
      <HeaderIconButton label="Настройки" active>
        <span>gear</span>
      </HeaderIconButton>,
    );
    const button = screen.getByRole("button", { name: "Настройки" });
    expect(button.querySelector(".bg-primary.rounded-full")).not.toBeNull();
  });

  it("omits the ink marker when nested in a positioned wrapper", () => {
    render(
      <div className="relative" data-ink>
        <HeaderIconButton label="Колокол" ink={false} badge={<span>3</span>}>
          <span>bell</span>
        </HeaderIconButton>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Колокол" });
    expect(button.querySelector("[data-ink]")).toBeNull();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders links with the route and label", () => {
    render(
      <MemoryRouter>
        <HeaderIconLink to="/settings" label="Настройки">
          <span>gear</span>
        </HeaderIconLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Настройки" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link.querySelector("[data-ink]")).not.toBeNull();
  });

  it("exposes a bare visual for custom wrappers", () => {
    render(
      <HeaderIconVisual label="x">
        <span>icon</span>
      </HeaderIconVisual>,
    );
    expect(screen.getByText("icon")).toBeInTheDocument();
  });
});
