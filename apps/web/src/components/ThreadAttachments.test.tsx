import { describe, it, expect, vi } from "vitest";
import { parseAttachments, renderAttachments } from "./ThreadAttachments";

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, key?: string | null) => key || null,
}));

vi.mock("@/components/MediaPlayer", () => ({
  MediaPlayer: ({ kind, sources }: any) => (
    <div data-testid={`media-${kind}`}>{sources?.[0]?.src}</div>
  ),
}));

vi.mock("@/components/AudioAttachment", () => ({
  AudioAttachment: ({ attachment }: any) => (
    <div data-testid="audio-attachment">{attachment.url}</div>
  ),
}));

import { render, screen } from "@testing-library/react";

describe("parseAttachments", () => {
  it("returns empty array for null", () => {
    expect(parseAttachments(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseAttachments(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAttachments("")).toEqual([]);
  });

  it("passes through array input", () => {
    const data = [{ url: "file.pdf", type: "file" }];
    expect(parseAttachments(data)).toEqual(data);
  });

  it("parses JSON string", () => {
    const data = [{ url: "img.jpg", type: "image" }];
    expect(parseAttachments(JSON.stringify(data))).toEqual(data);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseAttachments("not json")).toEqual([]);
  });

  it("returns empty array for non-array parsed JSON", () => {
    expect(parseAttachments(JSON.stringify({ not: "array" }))).toEqual([]);
  });
});

describe("renderAttachments", () => {
  it("returns null for empty attachments", () => {
    expect(renderAttachments([])).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(renderAttachments(null)).toBeNull();
  });

  it("renders image attachments", () => {
    const attachments = [{ url: "img.jpg", type: "image" as const, mime: "image/jpeg", name: "photo", size: 1000 }];
    const { container } = render(<>{renderAttachments(attachments)}</>);
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("renders video attachments", () => {
    const attachments = [{ url: "vid.mp4", type: "video" as const, mime: "video/mp4", name: "video", size: 5000 }];
    render(<>{renderAttachments(attachments)}</>);
    expect(screen.getByTestId("media-video")).toBeInTheDocument();
  });

  it("renders audio attachments", () => {
    const attachments = [{ url: "track.mp3", type: "audio" as const, mime: "audio/mpeg", name: "audio", size: 3000 }];
    render(<>{renderAttachments(attachments)}</>);
    expect(screen.getByTestId("audio-attachment")).toBeInTheDocument();
  });

  it("renders file attachments as links", () => {
    const attachments = [{ url: "doc.pdf", type: "file" as const, mime: "application/pdf", name: "document", size: 1024000 }];
    render(<>{renderAttachments(attachments)}</>);
    expect(screen.getByText("document")).toBeInTheDocument();
    expect(screen.getByText("1.0 МБ")).toBeInTheDocument();
  });

  it("renders multiple images as grid", () => {
    const attachments = [
      { url: "img1.jpg", type: "image" as const, mime: "image/jpeg", name: "a", size: 100 },
      { url: "img2.jpg", type: "image" as const, mime: "image/jpeg", name: "b", size: 100 },
    ];
    const { container } = render(<>{renderAttachments(attachments)}</>);
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(2);
  });
});
