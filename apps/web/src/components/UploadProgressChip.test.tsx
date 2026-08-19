import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { UploadProgressChip, type UploadingFileLike } from "./UploadProgressChip";

const onCancel = vi.fn();

const base = (overrides: Partial<UploadingFileLike> = {}): UploadingFileLike => ({
  id: "u1",
  name: "clip.mp4",
  progress: 0,
  type: "video",
  ...overrides,
});

describe("UploadProgressChip", () => {
  it("shows the live percent while bytes are uploading", () => {
    render(<UploadProgressChip file={base({ progress: 42, phase: "upload" })} onCancel={onCancel} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("swaps the frozen percentage for a spinner + hint while the server encodes a video", () => {
    render(<UploadProgressChip file={base({ progress: 100, phase: "processing" })} onCancel={onCancel} />);
    expect(screen.getByText("Обработка видео…")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    // Spinner is present while processing.
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows a checkmark once done", () => {
    render(<UploadProgressChip file={base({ progress: 100, phase: "done" })} onCancel={onCancel} />);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText("Обработка видео…")).not.toBeInTheDocument();
  });
});
