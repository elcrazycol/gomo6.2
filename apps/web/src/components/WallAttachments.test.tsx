import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AttachmentMeta } from "@/types/forum";

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("@/components/MediaPlayer", () => ({
  MediaPlayer: ({ kind, sources }: any) => (
    <div data-testid={`media-${kind}`}>{sources?.[0]?.src}</div>
  ),
}));

vi.mock("@/components/AudioAttachment", () => ({
  AudioAttachment: () => <div data-testid="audio-attachment">audio</div>,
}));

import { WallAttachments } from "./WallAttachments";

const onImageClick = vi.fn();

function imageAttachment(overrides: Partial<AttachmentMeta> = {}): AttachmentMeta {
  return {
    url: "img.jpg",
    type: "image",
    mime: "image/jpeg",
    name: "photo",
    size: 1000,
    ...overrides,
  };
}

describe("WallAttachments", () => {
  it("renders a single image fully fitted (object-contain) inside a viewport max height", () => {
    const attachment = imageAttachment({
      meta: {
        preview_key: "img.preview.jpg",
        lqip: "data:image/jpeg;base64,lqip",
        width: 800,
        height: 600,
        pipeline: "image-v2",
      },
    });
    const { container } = render(
      <WallAttachments attachments={[attachment]} galleryKey="wall-1" onImageClick={onImageClick} />
    );

    const button = container.querySelector("button");
    expect(button?.className).toContain("max-h-[70vh]");
    expect(button?.style.aspectRatio).toBe("1.3333333333333333");

    // Preview is loaded first; the fit mode must never crop.
    const img = container.querySelector('img[src="img.preview.jpg"]');
    expect(img).toBeInTheDocument();
    expect(img?.className).toContain("object-contain");
    // Blurred LQIP layer must use the same framing.
    expect(container.querySelector('img[src="data:image/jpeg;base64,lqip"]')).toBeInTheDocument();
  });

  it("renders a legacy single image (no meta) with object-contain and full height limit", () => {
    const { container } = render(
      <WallAttachments attachments={[imageAttachment()]} galleryKey="wall-1" onImageClick={onImageClick} />
    );

    const img = container.querySelector('img[src="img.jpg"]');
    expect(img).toBeInTheDocument();
    expect(img?.className).toContain("object-contain");
    expect(img?.className).toContain("max-h-[70vh]");
  });

  it("renders multiple images as grid tiles that fit instead of cropping", () => {
    const attachments = [
      imageAttachment({ url: "img1.jpg" }),
      imageAttachment({ url: "img2.jpg" }),
    ];
    const { container } = render(
      <WallAttachments attachments={attachments} galleryKey="wall-1" onImageClick={onImageClick} />
    );

    const grid = container.querySelector(".grid");
    expect(grid).toBeInTheDocument();
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button.className).toContain("h-40");
    });
    expect(container.querySelectorAll("img")).toHaveLength(2);
    container.querySelectorAll("img").forEach((img) => {
      expect(img.className).toContain("object-contain");
    });
  });

  it("opens the lightbox with resolved gallery items on image click", () => {
    const attachment = imageAttachment({ url: "img1.jpg" });
    render(
      <WallAttachments attachments={[attachment]} galleryKey="wall-1" onImageClick={onImageClick} />
    );

    screen.getByRole("button").click();
    expect(onImageClick).toHaveBeenCalledTimes(1);
    expect(onImageClick.mock.calls[0][0][0]).toMatchObject({ url: "img1.jpg", type: "image" });
  });

  it("renders video and audio attachments through their players", () => {
    const attachments: AttachmentMeta[] = [
      { url: "vid.webm", type: "video", mime: "video/webm", name: "video", size: 5000 },
      { url: "track.mp3", type: "audio", mime: "audio/mpeg", name: "audio", size: 3000 },
    ];
    render(
      <WallAttachments attachments={attachments} galleryKey="wall-1" onImageClick={onImageClick} />
    );

    expect(screen.getByTestId("media-video")).toBeInTheDocument();
    expect(screen.getByTestId("audio-attachment")).toBeInTheDocument();
  });
});
