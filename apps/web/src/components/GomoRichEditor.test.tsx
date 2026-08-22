import { render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GomoRichEditor } from "./GomoRichEditor";

// jsdom may not provide requestAnimationFrame, and ProseMirror schedules its
// DOM updates on it — shim it with a timer-based fallback (same pattern as
// AchievementUnlockToast.test.tsx).
const origRAF = window.requestAnimationFrame;
const origCAF = window.cancelAnimationFrame;

function stubRAF() {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 16) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) =>
    window.clearTimeout(id)) as typeof window.cancelAnimationFrame;
}

// The editor (and its CustomEmojiNode extension) pull emoji data from the
// context; a static empty dataset is enough for an empty document.
vi.mock("@/contexts/EmojiDataContext", () => ({
  useEmojiData: () => ({
    allEmojis: new Map(),
    resolveEmojis: vi.fn().mockResolvedValue(undefined),
    getEmojiUrl: () => null,
    customEmojiList: [],
  }),
}));

afterEach(() => {
  window.requestAnimationFrame = origRAF;
  window.cancelAnimationFrame = origCAF;
});

const editableClass = (container: HTMLElement): string => {
  const el = container.querySelector("[contenteditable]") as HTMLElement | null;
  expect(el).not.toBeNull();
  return el!.className;
};

// A controlled mock for document.fonts so the font-swap caret fix can be
// driven deterministically (jsdom has no FontFaceSet by default).
const installFontsMock = () => {
  let resolveReady!: () => void;
  const ready = new Promise<void>((res) => {
    resolveReady = res;
  });
  const loadingdoneListeners = new Set<() => void>();
  const fontsMock = {
    ready,
    addEventListener: (_type: string, cb: () => void) => loadingdoneListeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => loadingdoneListeners.delete(cb),
    // Test helper: fire a fresh font batch load completion.
    _fireLoadingDone: () => loadingdoneListeners.forEach((cb) => cb()),
    _resolveReady: () => resolveReady(),
  };
  const desc = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", { value: fontsMock, configurable: true, writable: true });
  return {
    fontsMock,
    restore: () => {
      if (desc) {
        Object.defineProperty(document, "fonts", desc);
      } else {
        delete (document as unknown as { fonts?: unknown }).fonts;
      }
    },
  };
};

describe("GomoRichEditor maxHeightClassName", () => {
  it("merges maxHeightClassName into the contenteditable class alongside the min height", () => {
    stubRAF();
    const { container } = render(
      <GomoRichEditor
        onChange={vi.fn()}
        minHeightClassName="min-h-[120px] sm:min-h-[140px]"
        maxHeightClassName="max-h-[45vh] overflow-y-auto overscroll-contain"
      />
    );

    const cls = editableClass(container);
    // The caller's min-height still applies…
    expect(cls).toContain("min-h-[120px]");
    // …and the cap + internal scrolling land on the editable itself.
    expect(cls).toContain("max-h-[45vh]");
    expect(cls).toContain("overflow-y-auto");
    expect(cls).toContain("overscroll-contain");
  });

  it("keeps the default min height and adds no cap when maxHeightClassName is omitted", () => {
    stubRAF();
    const { container } = render(<GomoRichEditor onChange={vi.fn()} />);

    const cls = editableClass(container);
    // Default min-height applies…
    expect(cls).toContain("min-h-[120px]");
    // …but nothing height-capping leaks into the class.
    expect(cls).not.toContain("max-h-[");
    expect(cls).not.toContain("overflow-y-auto");
  });

  it("does not collapse the class list when only maxHeightClassName is provided", () => {
    stubRAF();
    const { container } = render(
      <GomoRichEditor
        onChange={vi.fn()}
        maxHeightClassName="max-h-[40vh] overflow-y-auto"
      />
    );

    const cls = editableClass(container);
    expect(cls).toContain("min-h-[120px]"); // default min-height preserved
    expect(cls).toContain("max-h-[40vh]");
    expect(cls).toContain("overflow-y-auto");
    expect(cls).toContain("outline-none"); // base editor classes intact
    expect(cls).toContain("relative");
  });
});

describe("GomoRichEditor native-tap interception", () => {
  // A tap on the UNFOCUSED editor is a native focus on iOS — the focus-scroll
  // (pan) that makes the composer jump. It must be converted into a
  // programmatic focus({preventScroll:true}) with the caret at the tap point.
  const fireTouch = (editable: HTMLElement, type: string, x: number, y: number) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, type === "touchstart" ? "touches" : "changedTouches", {
      value: [{ clientX: x, clientY: y }],
    });
    editable.dispatchEvent(ev);
    return ev;
  };

  it("converts a tap on the unfocused editor into a programmatic focus", () => {
    stubRAF();
    const preventDefaultSpy = vi.spyOn(Event.prototype, "preventDefault");
    try {
      const { container } = render(<GomoRichEditor onChange={vi.fn()} />);
      const editable = container.querySelector("[contenteditable]") as HTMLElement | null;
      expect(editable).not.toBeNull();
      expect(document.activeElement).not.toBe(editable);

      // Tap-like touch (tiny movement, short): intercepted → focused.
      fireTouch(editable!, "touchstart", 10, 10);
      fireTouch(editable!, "touchend", 12, 12);
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(document.activeElement).toBe(editable);
    } finally {
      preventDefaultSpy.mockRestore();
    }
  });

  it("leaves scroll-like touches alone (no interception, no focus)", () => {
    stubRAF();
    const preventDefaultSpy = vi.spyOn(Event.prototype, "preventDefault");
    try {
      const { container } = render(<GomoRichEditor onChange={vi.fn()} />);
      const editable = container.querySelector("[contenteditable]") as HTMLElement | null;
      expect(editable).not.toBeNull();

      // A drag (50px move) is scroll intent — never intercepted.
      fireTouch(editable!, "touchstart", 10, 10);
      fireTouch(editable!, "touchend", 60, 10);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(editable);
    } finally {
      preventDefaultSpy.mockRestore();
    }
  });

  it("does not intercept when the editor already owns focus", () => {
    stubRAF();
    const preventDefaultSpy = vi.spyOn(Event.prototype, "preventDefault");
    try {
      const { container } = render(<GomoRichEditor onChange={vi.fn()} />);
      const editable = container.querySelector("[contenteditable]") as HTMLElement | null;
      editable!.focus();
      expect(document.activeElement).toBe(editable);

      fireTouch(editable!, "touchstart", 10, 10);
      fireTouch(editable!, "touchend", 12, 12);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    } finally {
      preventDefaultSpy.mockRestore();
    }
  });
});

describe("GomoRichEditor font-swap caret realignment", () => {
  // A focused editor + a spy on the native selection. Restored in every path.
  const setupFocusedEditor = () => {
    const selection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    } as unknown as Selection;
    const getSelectionSpy = vi
      .spyOn(window, "getSelection")
      .mockReturnValue(selection);
    return { selection, getSelectionSpy };
  };

  it("re-applies the DOM selection once fonts finish loading while focused", async () => {
    stubRAF();
    const { fontsMock, restore } = installFontsMock();
    const { selection, getSelectionSpy } = setupFocusedEditor();
    try {
      const { container } = render(<GomoRichEditor onChange={vi.fn()} />);
      const editable = container.querySelector("[contenteditable]") as HTMLElement | null;
      expect(editable).not.toBeNull();
      editable!.focus();

      // Fonts still loading: nothing re-applied yet.
      expect(selection.removeAllRanges).not.toHaveBeenCalled();

      // Font finishes loading → the focused editor re-applies its selection
      // so the browser re-measures the caret with the final font metrics.
      fontsMock._resolveReady();
      await fontsMock.ready;
      await Promise.resolve();

      expect(selection.removeAllRanges).toHaveBeenCalled();
      expect(selection.addRange).toHaveBeenCalled();
    } finally {
      getSelectionSpy.mockRestore();
      restore();
    }
  });

  it("does not touch the selection when the editor is not focused", async () => {
    stubRAF();
    const { fontsMock, restore } = installFontsMock();
    const { selection, getSelectionSpy } = setupFocusedEditor();
    try {
      render(<GomoRichEditor onChange={vi.fn()} />);

      fontsMock._resolveReady();
      await fontsMock.ready;
      await Promise.resolve();

      expect(selection.removeAllRanges).not.toHaveBeenCalled();
      expect(selection.addRange).not.toHaveBeenCalled();
    } finally {
      getSelectionSpy.mockRestore();
      restore();
    }
  });

  it("also realigns on a loadingdone batch while ready is still pending", async () => {
    stubRAF();
    const { fontsMock, restore } = installFontsMock();
    const { selection, getSelectionSpy } = setupFocusedEditor();
    try {
      const { container } = render(<GomoRichEditor onChange={vi.fn()} />);
      const editable = container.querySelector("[contenteditable]") as HTMLElement | null;
      editable!.focus();

      expect(selection.removeAllRanges).not.toHaveBeenCalled();

      // A font batch finishes (e.g. the @font-face stylesheet arriving late)
      // while fonts.ready is still pending → the loadingdone listener must
      // realign the caret too.
      fontsMock._fireLoadingDone();
      await Promise.resolve();

      expect(selection.removeAllRanges).toHaveBeenCalled();
      expect(selection.addRange).toHaveBeenCalled();
    } finally {
      getSelectionSpy.mockRestore();
      restore();
    }
  });
});
