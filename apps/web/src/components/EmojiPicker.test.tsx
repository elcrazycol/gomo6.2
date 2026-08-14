import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { addRecentEmoji, getRecentEmojis } from "@/lib/recentEmojis";

const mockPacks = [
  {
    id: "pack-1",
    name: "Тест",
    slug: "test",
    description: null,
    icon_url: null,
    emojis: [
      { id: "e-1", pack_id: "pack-1", name: "fire", image_url: "fire.webp", unicode_triggers: ["огонь"] },
    ],
  },
];

vi.mock("@/contexts/EmojiDataContext", () => ({
  useEmojiData: () => ({
    subscribedPacks: mockPacks,
    ownedPacks: [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useMobileKeyboard", () => ({
  useMobileKeyboard: () => ({ isTouch: true, isOpen: false, keyboardInset: 0, viewportHeight: 800 }),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (bucket: string, key: string) => `https://cdn/${bucket}/${key}`,
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

import { EmojiPicker } from "./EmojiPicker";

describe("EmojiPicker keyboardSwap mode", () => {
  const baseProps = {
    onEmojiSelect: vi.fn(),
    keyboardSwap: true,
    swapOpen: false,
    swapHeight: 300,
    onSwapToggle: vi.fn(),
    onSwapClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // jsdom has no layout engine — scrollTo is stubbed so the scroll-spy /
    // tab-centering code paths can run.
    Element.prototype.scrollTo = vi.fn(() => {}) as unknown as typeof Element.prototype.scrollTo;
  });

  it("renders the panel as a full-width bottom sheet with the keyboard height", () => {
    render(<EmojiPicker {...baseProps} swapOpen={true} />);

    const panel = screen.getByTestId("emoji-keyboard-panel");
    expect(panel).toBeInTheDocument();
    expect(panel.style.height).toBe("300px");
    // Slide-up animation class applied via the style shorthand.
    expect(panel.style.animation).toContain("emoji-sheet-up");
  });

  it("renders the stacked pack list with header tabs and no search field", () => {
    render(<EmojiPicker {...baseProps} swapOpen={true} />);

    expect(screen.getByTestId("emoji-keyboard-panel")).toBeInTheDocument();
    // The picker no longer ships a search field.
    expect(screen.queryByPlaceholderText("Поиск эмодзи...")).not.toBeInTheDocument();
    // The subscribed pack appears both as a tab and as a stacked section.
    expect(screen.getByTitle("Тест")).toBeInTheDocument();
    expect(screen.getByText("Тест")).toBeInTheDocument();
    // The "+" shortcut to the emoji catalog is present.
    expect(screen.getByTitle("Все паки эмодзи").closest("a")).toHaveAttribute("href", "/emojis");
  });

  it("shows the history section with recently used emojis on top", () => {
    addRecentEmoji({ emojiId: "recent-1", packId: "pack-1", url: "https://cdn/emojis/recent.webp", name: "recent" });
    render(<EmojiPicker {...baseProps} swapOpen={true} />);

    expect(screen.getByText("Недавние")).toBeInTheDocument();
    const btn = screen.getByTitle("recent");
    expect(btn.querySelector("img")).toHaveAttribute("src", "https://cdn/emojis/recent.webp");
  });

  it("emits the stored data when picking from the history section", () => {
    addRecentEmoji({ emojiId: "recent-1", packId: "pack-1", url: "https://cdn/emojis/recent.webp", name: "recent" });
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker {...baseProps} swapOpen={true} onEmojiSelect={onEmojiSelect} />);

    fireEvent.click(screen.getByTitle("recent"));
    expect(onEmojiSelect).toHaveBeenCalledWith({
      emojiId: "recent-1",
      packId: "pack-1",
      url: "https://cdn/emojis/recent.webp",
      name: "recent",
    });
  });

  it("records picked emojis into the history", () => {
    render(<EmojiPicker {...baseProps} swapOpen={true} />);

    fireEvent.click(screen.getByTitle("огонь"));
    expect(getRecentEmojis().map((e) => e.emojiId)).toContain("e-1");
  });

  it("emits the selected emoji data", () => {
    const onEmojiSelect = vi.fn();
    render(<EmojiPicker {...baseProps} swapOpen={true} onEmojiSelect={onEmojiSelect} />);

    fireEvent.click(screen.getByTitle("огонь"));
    expect(onEmojiSelect).toHaveBeenCalledWith({
      emojiId: "e-1",
      packId: "pack-1",
      url: "https://cdn/emojis/fire.webp",
      name: "fire",
    });
  });

  it("routes the trigger click to onSwapToggle instead of internal state", () => {
    const onSwapToggle = vi.fn();
    render(<EmojiPicker {...baseProps} onSwapToggle={onSwapToggle} />);

    fireEvent.click(screen.getByTestId("emoji-picker-trigger"));
    expect(onSwapToggle).toHaveBeenCalledTimes(1);
  });

  it("calls onSwapClose when clicking outside the panel", () => {
    const onSwapClose = vi.fn();
    render(
      <div>
        <div data-testid="outside" />
        <EmojiPicker {...baseProps} swapOpen={true} onSwapClose={onSwapClose} />
      </div>
    );

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onSwapClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the panel", () => {
    const onSwapClose = vi.fn();
    render(<EmojiPicker {...baseProps} swapOpen={true} onSwapClose={onSwapClose} />);

    fireEvent.mouseDown(screen.getByTestId("emoji-keyboard-panel"));
    expect(onSwapClose).not.toHaveBeenCalled();
  });

  it("closes the swap panel before navigating to the catalog from the + button", () => {
    const onSwapClose = vi.fn();
    render(<EmojiPicker {...baseProps} swapOpen={true} onSwapClose={onSwapClose} />);

    fireEvent.click(screen.getByTitle("Все паки эмодзи"));
    expect(onSwapClose).toHaveBeenCalledTimes(1);
  });

  it("scrolls to a pack section when its tab is clicked", () => {
    render(<EmojiPicker {...baseProps} swapOpen={true} />);

    const scroll = Element.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;
    scroll.mockClear();
    fireEvent.click(screen.getByTitle("Тест"));
    expect(scroll).toHaveBeenCalled();
  });

  it("unmounts the panel after the exit animation completes", () => {
    const { rerender } = render(<EmojiPicker {...baseProps} swapOpen={true} />);
    expect(screen.getByTestId("emoji-keyboard-panel")).toBeInTheDocument();

    // Close: the panel must stay mounted for the slide-down animation…
    rerender(<EmojiPicker {...baseProps} swapOpen={false} />);
    expect(screen.getByTestId("emoji-keyboard-panel")).toBeInTheDocument();

    // …and be fully removed once the animation ends (or the safety timer).
    fireEvent.animationEnd(screen.getByTestId("emoji-keyboard-panel"));
    expect(screen.queryByTestId("emoji-keyboard-panel")).not.toBeInTheDocument();
  });

  it("does not flash a closing panel on initial mount when closed", () => {
    const { container } = render(<EmojiPicker {...baseProps} swapOpen={false} />);
    expect(screen.queryByTestId("emoji-keyboard-panel")).not.toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it("renders the normal popover when keyboardSwap is off (desktop)", () => {
    render(<EmojiPicker {...baseProps} keyboardSwap={false} />);

    // Trigger opens the internal popover state.
    fireEvent.click(screen.getByTestId("emoji-picker-trigger"));
    expect(screen.getByTestId("emoji-picker-popover")).toBeInTheDocument();
    // Same stacked layout: pack tab + section, no search field.
    expect(screen.getByTitle("Тест")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Поиск эмодзи...")).not.toBeInTheDocument();
  });
});
