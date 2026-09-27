import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Spotlight } from "@/components/Spotlight";

describe("Spotlight", () => {
  it("tracks the pointer into CSS variables on mousemove", () => {
    render(
      <Spotlight className="block">
        <button type="button">Пункт</button>
      </Spotlight>,
    );

    const wrapper = screen.getByText("Пункт").closest('[class*="group/spot"]') as HTMLElement;
    expect(wrapper).toBeTruthy();

    fireEvent.mouseMove(wrapper, { clientX: 30, clientY: 12 });

    expect(wrapper.style.getPropertyValue("--spot-x")).toBe("30px");
    expect(wrapper.style.getPropertyValue("--spot-y")).toBe("12px");
  });
});
