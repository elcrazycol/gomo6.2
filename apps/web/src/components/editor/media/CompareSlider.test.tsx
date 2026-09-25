import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompareGallery } from "./CompareSlider";

describe("CompareGallery", () => {
  it("renders the divider, labels and the two media layers", () => {
    const { container } = render(
      <CompareGallery aspectRatio={1.5}>
        <figure data-media-block="true">до</figure>
        <figure data-media-block="true">после</figure>
      </CompareGallery>,
    );
    expect(container.querySelector(".media-group--compare")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-media-block]")).toHaveLength(2);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("До")).toBeInTheDocument();
    expect(screen.getByText("После")).toBeInTheDocument();
  });

  it("moves the divider with the keyboard", () => {
    render(
      <CompareGallery>
        <span>до</span>
        <span>после</span>
      </CompareGallery>,
    );
    const handle = screen.getByRole("slider");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "52");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle).toHaveAttribute("aria-valuenow", "100");
  });
});
