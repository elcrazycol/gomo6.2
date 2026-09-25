import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MediaAttachmentsProvider } from "@/components/editor/media/mediaViewContext";
import type { MediaAttachment } from "@/components/editor/media/mediaSchema";
import { PostTeaser } from "./PostTeaser";

vi.mock("@/components/ProseMirrorRenderer", () => ({
  ProseMirrorRenderer: ({ json }: { json: { content?: unknown[] } }) => (
    <div data-testid="teaser-text">{(json?.content ?? []).length} blocks</div>
  ),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

const media = (id: string) => ({
  type: "mediaBlock",
  attrs: { attachmentId: id, kind: "image", width: 100, align: "inline", aspect: 1 },
});

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Привет" }] },
    { type: "mediaGroup", content: [media("a1"), media("a2"), media("a3"), media("a4")] },
  ],
};

const attachments: MediaAttachment[] = ["a1", "a2", "a3", "a4"].map((id) => ({
  id,
  url: `${id}.jpg`,
  type: "image",
  mime: "image/jpeg",
  name: id,
  size: 1,
}));

describe("PostTeaser", () => {
  it("renders a text snippet, media tiles with +N and the show-more button", () => {
    const onOpenPost = vi.fn();
    const { container } = render(
      <MediaAttachmentsProvider value={{ attachments, inlineMedia: true, galleryKey: "g" }}>
        <PostTeaser contentJson={doc} onOpenPost={onOpenPost} />
      </MediaAttachmentsProvider>,
    );

    expect(screen.getByTestId("teaser-text")).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByText("+1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Показать больше/ }));
    expect(onOpenPost).toHaveBeenCalledTimes(1);
  });
});
