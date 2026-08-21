import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublishButton } from "@/components/PublishButton";
import { PUBLISH_BUTTON_STYLES, PUBLISH_BUTTON_STYLE_KEY, getPublishButtonStyle, setPublishButtonStyle } from "@/lib/publishButtonStyle";

describe("PublishButton", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders every selectable style with the label or accessible name", () => {
    for (const s of PUBLISH_BUTTON_STYLES) {
      render(<PublishButton style={s.id} onClick={() => {}} />);
    }
    // text-link / icon-pill / gradient-pill / neon-pill show the literal label.
    const buttons = screen.getAllByRole("button", { name: /Опубликовать/i });
    // send-circle has aria-label="Опубликовать", the four others show the text
    // label ("Опубликовать" or "Опубликовать →" via accessible text).
    expect(buttons.length).toBe(PUBLISH_BUTTON_STYLES.length);
  });

  it("fires onClick and disables while creating", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PublishButton style="gradient-pill" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /Опубликовать/i }));
    expect(onClick).toHaveBeenCalledTimes(1);

    const { rerender } = render(<PublishButton style="gradient-pill" creating onClick={onClick} />);
    expect(rerender).toBeDefined();
    const creatingBtn = screen.getAllByRole("button", { name: /Опубликовать/i }).at(-1);
    expect(creatingBtn).toBeDisabled();
  });

  it("persists the selected style via localStorage helpers", () => {
    expect(getPublishButtonStyle()).toBe("gradient-pill"); // default
    setPublishButtonStyle("neon-pill");
    expect(localStorage.getItem(PUBLISH_BUTTON_STYLE_KEY)).toBe("neon-pill");
    expect(getPublishButtonStyle()).toBe("neon-pill");
  });
});
