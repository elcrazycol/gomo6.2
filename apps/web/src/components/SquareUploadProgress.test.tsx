import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SquareUploadProgress } from "./SquareUploadProgress";

const arc = () =>
  document.querySelector(".square-upload-progress-arc") as SVGPathElement;

describe("SquareUploadProgress", () => {
  it("fills the frame as the percentage grows", () => {
    const { rerender } = render(<SquareUploadProgress percent={0} />);
    const start = Number(arc().getAttribute("stroke-dashoffset"));
    rerender(<SquareUploadProgress percent={50} />);
    const half = Number(arc().getAttribute("stroke-dashoffset"));
    rerender(<SquareUploadProgress percent={100} />);
    const done = Number(arc().getAttribute("stroke-dashoffset"));

    expect(start).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(done);
    expect(done).toBeCloseTo(0, 5);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("starts the frame at the middle of the bottom edge and runs clockwise", () => {
    render(<SquareUploadProgress percent={50} />);
    // Bottom-centre → left edge → top → right edge → back.
    expect(arc().getAttribute("d")).toMatch(/^M 50 97 L 15 97/);
  });

  it("clamps out-of-range percentages", () => {
    render(<SquareUploadProgress percent={250} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("hides the numeric percent while the server is processing a video", () => {
    render(<SquareUploadProgress percent={100} phase="processing" />);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("shows the numeric percent during the byte upload", () => {
    render(<SquareUploadProgress percent={37} phase="upload" />);
    expect(screen.getByText("37%")).toBeInTheDocument();
  });
});
