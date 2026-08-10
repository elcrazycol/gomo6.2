import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NicknameEmoji } from "./NicknameEmoji";

const mockAllEmojis = new Map<string, { id: string; name: string; image_url: string }>();
const mockResolveEmojis = vi.fn();

vi.mock("@/contexts/EmojiDataContext", () => ({
  useEmojiData: () => ({
    allEmojis: mockAllEmojis,
    resolveEmojis: mockResolveEmojis,
  }),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, key: string) => `https://cdn.example/${key}`,
}));

describe("NicknameEmoji", () => {
  beforeEach(() => {
    mockAllEmojis.clear();
    mockResolveEmojis.mockClear();
  });

  it("renders nothing when emojiId is missing", () => {
    const { container } = render(<NicknameEmoji emojiId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the emoji image when the emoji is known", () => {
    mockAllEmojis.set("e1", { id: "e1", name: "cat", image_url: "cat.png" });
    render(<NicknameEmoji emojiId="e1" />);
    const img = screen.getByRole("img", { name: "cat" });
    expect(img).toHaveAttribute("src", "https://cdn.example/cat.png");
  });

  it("requests resolution of unknown emoji ids", () => {
    render(<NicknameEmoji emojiId="unknown-id" />);
    expect(mockResolveEmojis).toHaveBeenCalledWith(["unknown-id"]);
  });

  it("does not request resolution for known emojis", () => {
    mockAllEmojis.set("e2", { id: "e2", name: "dog", image_url: "dog.png" });
    render(<NicknameEmoji emojiId="e2" />);
    expect(mockResolveEmojis).not.toHaveBeenCalled();
  });
});
