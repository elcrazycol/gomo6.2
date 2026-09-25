import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MediaAttachment } from "./mediaSchema";
import { DEFAULT_MEDIA_BLOCK_ATTRS } from "./mediaSchema";

vi.mock("@/components/WallAttachments", () => ({
  WallAttachments: ({ attachments }: { attachments: MediaAttachment[] }) => (
    <div data-testid="wall-attachments">{attachments.map((att) => att.id).join(",")}</div>
  ),
}));

import { MediaBlockRenderer } from "./MediaBlockView";
import { mediaFigureLayout, mediaGroupLayoutClass } from "./mediaLayout";
import { MediaAttachmentsProvider } from "./mediaViewContext";

const attachment = (id: string): MediaAttachment => ({
  id,
  url: "u",
  type: "image",
  mime: "image/webp",
  name: "photo",
  size: 1,
});

const renderBlock = (
  attrs: Partial<typeof DEFAULT_MEDIA_BLOCK_ATTRS> = {},
  opts: { inlineMedia?: boolean; attachments?: MediaAttachment[]; hiddenMediaIds?: ReadonlySet<string> } = {},
) =>
  render(
    <MediaAttachmentsProvider
      value={{
        attachments: opts.attachments ?? [attachment("att_1")],
        inlineMedia: opts.inlineMedia ?? true,
        galleryKey: "g",
        hiddenMediaIds: opts.hiddenMediaIds,
      }}
    >
      <MediaBlockRenderer attrs={{ ...DEFAULT_MEDIA_BLOCK_ATTRS, attachmentId: "att_1", ...attrs }} />
    </MediaAttachmentsProvider>,
  );

describe("MediaBlockRenderer", () => {
  it("resolves the block's attachment from the pool", () => {
    renderBlock();
    expect(screen.getByTestId("wall-attachments")).toHaveTextContent("att_1");
    expect(screen.getByText("att_1")).toBeInTheDocument();
  });

  it("hides a media block listed in hiddenMediaIds (cover with no inline placement)", () => {
    const { container } = renderBlock({}, { hiddenMediaIds: new Set(["att_1"]) });
    expect(container.querySelector("[data-media-block]")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wall-attachments")).not.toBeInTheDocument();
  });

  it("renders a caption under the media", () => {
    renderBlock({ caption: "Подпись" });
    expect(screen.getByText("Подпись")).toBeInTheDocument();
  });

  it("degrades gracefully when the attachment is missing", () => {
    const { container } = renderBlock({ attachmentId: "missing" });
    expect(container.querySelector("[data-media-missing]")).toBeInTheDocument();
    expect(screen.queryByTestId("wall-attachments")).not.toBeInTheDocument();
  });

  it("shows a link chip for safe hrefs only", () => {
    const { rerender, container } = renderBlock({ href: "https://example.com" });
    expect(container.querySelector("a[href='https://example.com']")).toBeInTheDocument();

    rerender(
      <MediaAttachmentsProvider
        value={{ attachments: [attachment("att_1")], inlineMedia: true, galleryKey: "g" }}
      >
        <MediaBlockRenderer
          attrs={{ ...DEFAULT_MEDIA_BLOCK_ATTRS, attachmentId: "att_1", href: "javascript:alert(1)" }}
        />
      </MediaAttachmentsProvider>,
    );
    expect(container.querySelector("a")).not.toBeInTheDocument();
  });

  it("honours the inlineMedia kill-switch", () => {
    const { container } = renderBlock({}, { inlineMedia: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("mediaFigureLayout", () => {
  it("defaults to inline natural flow (not a full-width block)", () => {
    const layout = mediaFigureLayout("inline", 35);
    expect(layout.className).toContain("inline-block");
    expect(layout.style.width).toBe("35%");
  });

  it("floats left and right for text wrap", () => {
    expect(mediaFigureLayout("left", 40).className).toContain("float-left");
    expect(mediaFigureLayout("right", 40).className).toContain("float-right");
  });

  it("spans full width for the full placement", () => {
    expect(mediaFigureLayout("full", 20).style.width).toBe("100%");
    expect(mediaFigureLayout("full", 20).className).toContain("w-full");
  });
});

describe("mediaGroupLayoutClass", () => {
  it("maps each layout to a media-group class", () => {
    expect(mediaGroupLayoutClass("grid")).toBe("media-group media-group--grid");
    expect(mediaGroupLayoutClass("carousel")).toContain("media-group--carousel");
    expect(mediaGroupLayoutClass("compare")).toContain("media-group--compare");
    expect(mediaGroupLayoutClass("mosaic")).toContain("media-group--mosaic");
  });
});
