import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CurrencyIcon } from "./CurrencyIcon";

describe("CurrencyIcon", () => {
  it("renders a ruby for gems", () => {
    const { container } = render(<CurrencyIcon kind="gems" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("text-rose-400")).toBe(true);
  });

  it("renders a coin for drops", () => {
    const { container } = render(<CurrencyIcon kind="drops" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("text-amber-400")).toBe(true);
  });

  it("merges a custom className", () => {
    const { container } = render(<CurrencyIcon kind="gems" className="h-3 w-3" />);
    expect(container.querySelector("svg.h-3.w-3")).not.toBeNull();
  });
});
