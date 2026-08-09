import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AttachmentUpload } from "./AttachmentUpload";
import { uploadAttachments } from "@/utils/mediaUpload";
import type { AttachmentMeta } from "@/types/forum";
import { toast } from "sonner";

vi.mock("@/utils/mediaUpload", () => ({
  uploadAttachments: vi.fn(),
}));

vi.mock("@/utils/mediaCache", () => ({
  clearMediaCache: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/AudioAttachment", () => ({
  AudioAttachment: ({ attachment }: any) => <div data-testid="audio-attachment">{attachment.name}</div>,
}));

const makeUploaded = (): AttachmentMeta[] => [
  {
    url: "user1/img1.jpg",
    type: "image",
    mime: "image/jpeg",
    name: "img1.jpg",
    size: 12345,
  },
];

describe("AttachmentUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the attach button", () => {
    render(<AttachmentUpload value={[]} onChange={() => {}} />);
    expect(screen.getByLabelText("Добавить файл")).toBeInTheDocument();
  });

  it("shows a live progress chip while uploadAttachments reports progress", async () => {
    vi.mocked(uploadAttachments).mockImplementation(
      async (_files, _bucket, onProgress?: (p: { index: number; name: string; percent: number }) => void) => {
        onProgress?.({ index: 0, name: "img1.jpg", percent: 42 });
        return new Promise<AttachmentMeta[]>(() => {});
      }
    );

    const onChange = vi.fn();
    render(<AttachmentUpload value={[]} onChange={onChange} />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("attachment-upload-input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(uploadAttachments).toHaveBeenCalledTimes(1);
    });
    expect(uploadAttachments).toHaveBeenCalledWith([file], "content", expect.any(Function));

    expect(screen.getByText("img1.jpg")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lands uploaded attachments in onChange after the upload resolves", async () => {
    vi.mocked(uploadAttachments).mockResolvedValue(makeUploaded());

    const onChange = vi.fn();
    render(<AttachmentUpload value={[]} onChange={onChange} />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("attachment-upload-input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(makeUploaded());
    });
  });

  it("cancelling a chip drops its result when the upload resolves", async () => {
    let resolveUpload: (v: AttachmentMeta[]) => void = () => {};
    vi.mocked(uploadAttachments).mockImplementation(
      () => new Promise<AttachmentMeta[]>((resolve) => { resolveUpload = resolve; })
    );

    const onChange = vi.fn();
    render(<AttachmentUpload value={[]} onChange={onChange} />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("attachment-upload-input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("img1.jpg")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Отменить загрузку"));

    resolveUpload(makeUploaded());
    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("handles upload errors with a toast and clears the chips", async () => {
    vi.mocked(uploadAttachments).mockRejectedValue(new Error("Upload failed"));

    const onChange = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<AttachmentUpload value={[]} onChange={onChange} />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("attachment-upload-input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(onChange).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
