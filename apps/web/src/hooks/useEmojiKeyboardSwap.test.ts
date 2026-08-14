import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetState = vi.fn();
const mockIsEditable = vi.fn();

vi.mock("@/lib/mobileKeyboard", () => ({
  getMobileKeyboardState: (...args: any[]) => mockGetState(...args),
  isEditableElement: (...args: any[]) => mockIsEditable(...args),
}));

vi.mock("@/hooks/useMobileKeyboard", () => ({
  useMobileKeyboard: () => ({ isTouch: true, isOpen: false, keyboardInset: 0, viewportHeight: 800 }),
}));

import { useEmojiKeyboardSwap } from "./useEmojiKeyboardSwap";

describe("useEmojiKeyboardSwap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ isTouch: true, isOpen: true, keyboardInset: 300, viewportHeight: 500 });
    mockIsEditable.mockReturnValue(true);
  });

  const makeEditorRef = () => ({ current: { focus: vi.fn(), insertText: vi.fn(), insertEmoji: vi.fn() } });

  it("opens with the exact keyboard height and blurs the focused editor", () => {
    const ref = makeEditorRef();
    const el = document.createElement("textarea");
    document.body.appendChild(el);
    const blurSpy = vi.fn();
    el.blur = blurSpy;
    el.focus();

    const { result } = renderHook(() => useEmojiKeyboardSwap(ref as any));

    act(() => result.current.toggle());

    expect(result.current.open).toBe(true);
    expect(result.current.height).toBe(300); // exact keyboard inset
    expect(blurSpy).toHaveBeenCalled();

    el.remove();
  });

  it("falls back to a provisional height when the keyboard was never open", () => {
    mockGetState.mockReturnValue({ isTouch: true, isOpen: false, keyboardInset: 0, viewportHeight: 800 });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    mockIsEditable.mockReturnValue(false);

    const ref = makeEditorRef();
    const { result } = renderHook(() => useEmojiKeyboardSwap(ref as any));

    act(() => result.current.toggle());

    expect(result.current.open).toBe(true);
    // 40% of 800 = 320, clamped to [280, 420]
    expect(result.current.height).toBe(320);
  });

  it("toggles closed and refocuses the editor (keyboard returns)", () => {
    const ref = makeEditorRef();
    const { result } = renderHook(() => useEmojiKeyboardSwap(ref as any));

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    expect(ref.current.focus).toHaveBeenCalledTimes(1);
  });

  it("closePanel(false) closes without refocusing", () => {
    const ref = makeEditorRef();
    const { result } = renderHook(() => useEmojiKeyboardSwap(ref as any));

    act(() => result.current.toggle());
    act(() => result.current.closePanel(false));

    expect(result.current.open).toBe(false);
    expect(ref.current.focus).not.toHaveBeenCalled();
  });

  it("closes the panel when focus lands on an editable (user taps the editor)", () => {
    const ref = makeEditorRef();
    const el = document.createElement("textarea");
    document.body.appendChild(el);

    const { result } = renderHook(() => useEmojiKeyboardSwap(ref as any));

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    mockIsEditable.mockReturnValue(true);
    act(() => {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(result.current.open).toBe(false);
    el.remove();
  });

  it("keeps the panel open when the page scrolls (only explicit actions close it)", () => {
    const ref = makeEditorRef();
    const { result } = renderHook(() => useEmojiKeyboardSwap(ref as any));

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    // Scrolling — the panel is a scrollable surface itself, so page scroll
    // must never dismiss it; only outside click / Escape / trigger / focus do.
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.open).toBe(true);
  });
});
