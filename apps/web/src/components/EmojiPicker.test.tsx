import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
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
  });

  it("renders the panel as a full-width bottom sheet with the keyboard height", () => {
    render(<EmojiPicker {...baseProps} swapOpen={true} />);

    const panel = screen.getByTestId("emoji-keyboard-panel");
    expect(panel).toBeInTheDocument();
    expect(panel.style.height).toBe("300px");
    // Slide-up animation class applied via the style shorthand.
    expect(panel.style.animation).toContain("emoji-sheet-up");
  });

  it("does not render the popover when swap mode is active", () => {
    render(<EmojiPicker {...baseProps} swapOpen={true} />);
    // The keyboard panel exists; the popover content (search input) must not.
    expect(screen.queryByPlaceholderText("Поиск эмодзи...")).not.toBeInTheDocument();
    expect(screen.getByTestId("emoji-keyboard-panel")).toBeInTheDocument();
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

  it("unmounts the panel after the exit animation completes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<EmojiPicker {...baseProps} swapOpen={true} />);
    expect(screen.getByTestId("emoji-keyboard-panel")).toBeInTheDocument();

    // Close: the panel must stay mounted for the slide-down animation…
    rerender(<EmojiPicker {...baseProps} swapOpen={false} />);
    expect(screen.getByTestId("emoji-keyboard-panel")).toBeInTheDocument();

    // …and be fully removed once the animation ends (or the safety timer).
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByTestId("emoji-keyboard-panel")).not.toBeInTheDocument();
    vi.useRealTimers();
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
    expect(screen.getByPlaceholderText("Поиск эмодзи...")).toBeInTheDocument();
  });
});
