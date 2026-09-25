import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProseMirrorRenderer } from "./ProseMirrorRenderer";
import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import type { MediaAttachment } from "@/components/editor/media/mediaSchema";

vi.mock("@/components/WallAttachments", () => ({
  WallAttachments: ({ attachments }: { attachments: MediaAttachment[] }) => (
    <div data-testid="wall-attachments">{attachments.map((att) => att.id).join(",")}</div>
  ),
}));

vi.mock("@/components/EmojiInline", () => ({
  EmojiInline: ({ emojiId }: { emojiId: string }) => <span data-testid="emoji">{emojiId}</span>,
}));

vi.mock("@/components/CensorBlur", () => ({
  CensorBlur: ({ children }: { children: React.ReactNode }) => <span data-testid="spoiler">{children}</span>,
}));

vi.mock("@/components/MentionLink", () => ({
  MentionLink: ({ username }: { username: string }) => <a href={`/u/${username}`}>@{username}</a>,
}));

interface TestNode {
  type: string;
  content?: TestNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const renderDoc = (content: TestNode[]) =>
  render(
    <ProseMirrorRenderer json={{ type: "doc", content } as Parameters<typeof ProseMirrorRenderer>[0]["json"]} />,
  );

describe("ProseMirrorRenderer", () => {
  it("renders paragraphs with text", () => {
    renderDoc([
      { type: "paragraph", content: [{ type: "text", text: "ку" }] },
    ]);
    expect(screen.getByText("ку")).toBeInTheDocument();
  });

  it("does not render trailing empty paragraphs (Enter-to-submit leftovers)", () => {
    const { container } = renderDoc([
      { type: "paragraph", content: [{ type: "text", text: "ку" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "\u200b" }] },
      { type: "paragraph", content: [{ type: "hardBreak" }] },
    ]);
    // Only one paragraph block should exist in the DOM.
    expect(container.querySelectorAll("[class~='mb-2']")).toHaveLength(1);
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("keeps intentional empty paragraphs in the middle", () => {
    const { container } = renderDoc([
      { type: "paragraph", content: [{ type: "text", text: "первая" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "третья" }] },
    ]);
    expect(container.querySelectorAll("[class~='mb-2']")).toHaveLength(3);
  });

  it("drops leading empty paragraphs too (blank line above the post)", () => {
    const { container } = renderDoc([
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "ку" }] },
    ]);
    const blocks = container.querySelectorAll("[class~='mb-2']");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveTextContent("ку");
  });

  const mediaAttachment: MediaAttachment = {
    id: "att_1",
    url: "u",
    type: "image",
    mime: "image/webp",
    name: "photo",
    size: 1,
  };

  const renderWithMedia = (
    content: TestNode[],
    { inlineMedia = true }: { inlineMedia?: boolean } = {},
  ) =>
    render(
      <MediaAttachmentsProvider value={{ attachments: [mediaAttachment], inlineMedia, galleryKey: "g" }}>
        <ProseMirrorRenderer
          json={{ type: "doc", content } as Parameters<typeof ProseMirrorRenderer>[0]["json"]}
        />
      </MediaAttachmentsProvider>,
    );

  it("dispatches mediaBlock to the media view when inline media is on", () => {
    renderWithMedia([{ type: "mediaBlock", attrs: { attachmentId: "att_1", align: "center", width: 100 } }]);
    expect(screen.getByTestId("wall-attachments")).toHaveTextContent("att_1");
  });

  it("skips mediaBlock when inline media is off (legacy fallback path)", () => {
    const { container } = renderWithMedia(
      [{ type: "mediaBlock", attrs: { attachmentId: "att_1" } }],
      { inlineMedia: false },
    );
    expect(container.querySelector("[data-media-block]")).not.toBeInTheDocument();
  });

  it("drops the transient uploadPlaceholder node", () => {
    const { container } = renderWithMedia([{ type: "uploadPlaceholder", attrs: { uploadId: "u1" } }]);
    expect(container.querySelector("[data-media-block]")).not.toBeInTheDocument();
  });

  it("renders a mediaGroup as a grid of its children", () => {
    const { container } = renderWithMedia([
      {
        type: "mediaGroup",
        content: [
          { type: "mediaBlock", attrs: { attachmentId: "att_1" } },
          { type: "mediaBlock", attrs: { attachmentId: "att_1" } },
        ],
      },
    ]);
    expect(container.querySelector("[data-media-group]")).toBeInTheDocument();
    expect(screen.getAllByTestId("wall-attachments")).toHaveLength(2);
  });
});
