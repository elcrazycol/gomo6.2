import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AvatarUploadProgress } from "./AvatarUploadProgress";

const arc = () =>
  document.querySelector(".avatar-upload-progress-arc") as SVGCircleElement;

describe("AvatarUploadProgress", () => {
  it("exposes the upload percentage to assistive tech", () => {
    render(<AvatarUploadProgress percent={42} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("closes the ring clockwise as the percentage grows", () => {
    const { rerender } = render(<AvatarUploadProgress percent={0} />);
    const offset0 = Number(arc().getAttribute("stroke-dashoffset"));
    rerender(<AvatarUploadProgress percent={50} />);
    const offset50 = Number(arc().getAttribute("stroke-dashoffset"));
    rerender(<AvatarUploadProgress percent={100} />);
    const offset100 = Number(arc().getAttribute("stroke-dashoffset"));

    // A full-circumference gap at 0%, half at 50%, none at 100%.
    expect(offset0).toBeGreaterThan(offset50);
    expect(offset50).toBeGreaterThan(offset100);
    expect(offset100).toBeCloseTo(0, 5);
  });

  it("clamps out-of-range percentages", () => {
    const { rerender } = render(<AvatarUploadProgress percent={140} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    rerender(<AvatarUploadProgress percent={-10} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
