import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { handleNavArrowKeys } from "./navKeyboard";

/** A stand-in for the settings sidebar / mobile hub list. */
const List = () => (
  <div onKeyDown={handleNavArrowKeys}>
    <button type="button" data-nav-item>
      One
    </button>
    <button type="button" data-nav-item>
      Two
    </button>
    <button type="button" data-nav-item disabled>
      Three
    </button>
  </div>
);

describe("handleNavArrowKeys", () => {
  it("moves focus down and up through the items, skipping disabled ones", async () => {
    render(<List />);
    const one = screen.getByText("One");
    const two = screen.getByText("Two");

    one.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(two).toHaveFocus();

    // "Three" is disabled, so Down wraps back to the first item.
    await userEvent.keyboard("{ArrowDown}");
    expect(one).toHaveFocus();

    await userEvent.keyboard("{ArrowUp}");
    expect(two).toHaveFocus();
  });

  it("treats Left/Right as Up/Down", async () => {
    render(<List />);
    const one = screen.getByText("One");
    const two = screen.getByText("Two");

    one.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(two).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(one).toHaveFocus();
  });

  it("jumps to the first and last item with Home and End", async () => {
    render(<List />);
    const one = screen.getByText("One");
    const two = screen.getByText("Two");

    one.focus();
    await userEvent.keyboard("{End}");
    expect(two).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(one).toHaveFocus();
  });

  it("ignores unrelated keys", async () => {
    render(<List />);
    const one = screen.getByText("One");
    one.focus();
    await userEvent.keyboard("{Enter}");
    expect(one).toHaveFocus();
  });
});
