import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { WallPost } from "@/utils/wallNormalizers";

vi.mock("@/integrations/api/compat", () => ({
  api: { from: vi.fn(() => ({ insert: vi.fn(), update: vi.fn(), select: vi.fn(), single: vi.fn() })) },
}));

vi.mock("@/contexts/EmojiDataContext", () => ({
  useEmojiData: () => ({ customEmojiList: [] }),
  EmojiDataProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/components/EmojiPicker", () => ({
  EmojiPicker: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/utils/mediaUpload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/mediaUpload")>();
  return {
    ...actual,
    uploadAttachments: vi.fn().mockResolvedValue([]),
    uploadEditedDataUrl: vi.fn().mockResolvedValue({}),
  };
});

import { CreateWallPostInline } from "./CreateWallPostInline";
import { deterministicAttachmentId, ensureAttachmentIds } from "@/components/editor/media/mediaSchema";

const basePost = (overrides: Partial<WallPost> = {}): WallPost =>
  ({
    id: "post-1",
    user_id: "owner-1",
    author_id: "author-1",
    content: "Привет",
    content_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Привет" }] }] },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    author: { username: "alice", is_anonymous: false },
    ...overrides,
  }) as WallPost;

const noop = () => {};

describe("CreateWallPostInline", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders the inline composer", () => {
    render(
      <CreateWallPostInline profileUserId="owner-1" currentUserId="author-1" onCancel={noop} onPostCreated={noop} />,
    );
    expect(screen.getByTestId("wall-post-composer-inline")).toBeInTheDocument();
    expect(screen.getByText("Новая запись на стене")).toBeInTheDocument();
  });

  it("converts legacy attachments into media blocks when editing", async () => {
    const attachment = {
      url: "photo.jpg",
      type: "image" as const,
      mime: "image/jpeg",
      name: "photo",
      size: 100,
    };
    render(
      <CreateWallPostInline
        profileUserId="owner-1"
        currentUserId="author-1"
        editingPost={basePost({ attachments: [attachment] })}
        onCancel={noop}
        onPostUpdated={noop}
      />,
    );
    // The editor appended a mediaBlock for the legacy attachment. The composer
    // ports into document.body, so query there.
    await waitFor(() => {
      expect(document.body.querySelector("[data-media-block]")).toBeInTheDocument();
    });
    // Its id matches what the read fallback derives from the same path.
    expect(ensureAttachmentIds([attachment])[0].id).toBe(deterministicAttachmentId(attachment.url));
  });

  it("publish is disabled while the post is empty", () => {
    render(
      <CreateWallPostInline profileUserId="owner-1" currentUserId="author-1" onCancel={noop} onPostCreated={noop} />,
    );
    const publish = screen.getByRole("button", { name: /опубликовать/i });
    expect(publish).toBeDisabled();
  });
});
