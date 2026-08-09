import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { ProfileAttachmentUpload, type ProfileAttachmentUploadHandle } from "./ProfileAttachmentUpload";
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

// Mirrors the real storageUrl contract: absolute URLs pass through unchanged
// (wall attachments already carry full storage URLs), bare keys get the bucket
// prefix for the legacy public bucket.
vi.mock("@/utils/storage", () => ({
  storageUrl: (bucket: string, key?: string | null) => {
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) return key;
    return `/storage/${bucket}/${key}`;
  },
}));

const FULL_URL = "https://cdn.example/storage/v1/object/wall/img1.jpg";

const makeUploaded = (overrides: Partial<AttachmentMeta> = {}): AttachmentMeta[] => [
  {
    url: FULL_URL,
    type: "image",
    mime: "image/jpeg",
    name: "img1.jpg",
    size: 12345,
    ...overrides,
  },
];

describe("ProfileAttachmentUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the attach button", () => {
    render(<ProfileAttachmentUpload value={[]} onChange={() => {}} />);
    expect(screen.getByLabelText("Добавить файл")).toBeInTheDocument();
  });

  it("shows a live progress chip while uploadAttachments reports progress", async () => {
    // Keep the upload pending so the progress state stays visible for assertions.
    vi.mocked(uploadAttachments).mockImplementation(
      async (_files, _bucket, onProgress?: (p: { index: number; name: string; percent: number }) => void) => {
        onProgress?.({ index: 0, name: "img1.jpg", percent: 42 });
        return new Promise<AttachmentMeta[]>(() => {});
      }
    );

    const ref = createRef<ProfileAttachmentUploadHandle>();
    const onChange = vi.fn();
    render(<ProfileAttachmentUpload ref={ref} value={[]} onChange={onChange} bucket="wall" />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("attachment-upload-input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(uploadAttachments).toHaveBeenCalledTimes(1);
    });
    expect(uploadAttachments).toHaveBeenCalledWith([file], "wall", expect.any(Function));

    // The chip shows the file name and the live percent.
    expect(screen.getByText("img1.jpg")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lands uploaded attachments in onChange after the upload resolves", async () => {
    vi.mocked(uploadAttachments).mockResolvedValue(makeUploaded());

    const ref = createRef<ProfileAttachmentUploadHandle>();
    const onChange = vi.fn();
    render(<ProfileAttachmentUpload ref={ref} value={[]} onChange={onChange} bucket="wall" />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    ref.current?.attachFiles([file]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(makeUploaded());
    });
  });

  it("renders image thumbnails with a remove button", () => {
    const onChange = vi.fn();
    render(<ProfileAttachmentUpload value={makeUploaded()} onChange={onChange} bucket="wall" />);

    const img = screen.getByAltText("img1.jpg");
    expect(img).toHaveAttribute("src", FULL_URL);

    const remove = screen.getByLabelText("Удалить");
    fireEvent.click(remove);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("attachFiles() exposes the same upload pipeline as the button", async () => {
    vi.mocked(uploadAttachments).mockResolvedValue(makeUploaded());

    const ref = createRef<ProfileAttachmentUploadHandle>();
    const onChange = vi.fn();
    render(<ProfileAttachmentUpload ref={ref} value={[]} onChange={onChange} bucket="wall" />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    ref.current?.attachFiles([file]);

    await waitFor(() => {
      expect(uploadAttachments).toHaveBeenCalledWith([file], "wall", expect.any(Function));
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(makeUploaded());
    });
  });

  it("handles upload errors with a toast and clears the chips", async () => {
    vi.mocked(uploadAttachments).mockRejectedValue(new Error("Upload failed"));

    const ref = createRef<ProfileAttachmentUploadHandle>();
    const onChange = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<ProfileAttachmentUpload ref={ref} value={[]} onChange={onChange} bucket="wall" />);

    const file = new File(["x"], "img1.jpg", { type: "image/jpeg" });
    ref.current?.attachFiles([file]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Upload failed");
    });
    expect(onChange).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
