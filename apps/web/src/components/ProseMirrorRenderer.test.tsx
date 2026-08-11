import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProseMirrorRenderer } from "./ProseMirrorRenderer";

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
});
