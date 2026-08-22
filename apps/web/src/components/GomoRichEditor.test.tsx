import { render } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { TextSelection } from "@tiptap/pm/state";
import { GomoRichEditor, type GomoRichEditorHandle } from "./GomoRichEditor";

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

describe("GomoRichEditor caret placement", () => {
  const renderWithRef = (props: Partial<React.ComponentProps<typeof GomoRichEditor>> = {}) => {
    const ref = createRef<GomoRichEditorHandle>();
    const utils = render(<GomoRichEditor ref={ref} onChange={vi.fn()} {...props} />);
    return { ref, ...utils };
  };

  it("moveCaretToEnd places the caret at the end of a draft", async () => {
    stubRAF();
    const { ref, container } = renderWithRef({ legacyContent: "hello world" });
    const editable = container.querySelector("[contenteditable]") as HTMLElement | null;
    expect(editable).not.toBeNull();
    editable!.focus();

    ref.current?.moveCaretToEnd();
    const editor = ref.current?.getEditor();
    const doc = editor!.state.doc;
    // Caret at the very end of the last textblock (after "world").
    expect(editor!.state.selection.from).toBe(TextSelection.atEnd(doc).from);
    expect(editor!.state.selection.empty).toBe(true);
    // The NATIVE DOM selection must agree (iOS sometimes ignores PM's
    // dispatch and keeps the caret at the start) — collapsed at the end of
    // the last text node inside the editable.
    const domSel = window.getSelection();
    expect(domSel?.anchorNode?.textContent).toBe("hello world");
    expect(domSel?.anchorOffset).toBe("hello world".length);
    expect(domSel?.isCollapsed).toBe(true);
  });

  it("autoFocus places the caret at the end of an existing draft", async () => {
    stubRAF();
    const { ref } = renderWithRef({ legacyContent: "hello world", autoFocus: true });
    const editor = ref.current?.getEditor();
    // The autofocus effect places the caret at the end BEFORE focusing, then
    // re-asserts once in the next frame — the caret must sit at the end of the
    // draft (not the start a native focus would leave it at).
    await vi.waitFor(() => {
      expect(editor!.state.selection.from).toBe(TextSelection.atEnd(editor!.state.doc).from);
    });
  });

  it("autoFocus on an empty draft still lands at a valid position", async () => {
    stubRAF();
    const { ref } = renderWithRef({ autoFocus: true });
    await vi.waitFor(() => {
      const editor = ref.current?.getEditor();
      expect(editor?.isFocused).toBe(true);
      expect(editor!.state.selection.empty).toBe(true);
    });
  });

  it("forces preventScroll on Tiptap's internal view.dom.focus() calls", async () => {
    stubRAF();
    vi.useFakeTimers();
    try {
      // Install the spy BEFORE render: the patch binds the (spied) native
      // focus at mount, so every focus through the editor's DOM node is
      // recorded with the options it actually received.
      const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
      const { ref } = renderWithRef({ legacyContent: "hello" });
      const editor = ref.current?.getEditor();
      expect(editor).not.toBeNull();

      // Tiptap's focus command calls view.dom.focus() WITHOUT preventScroll on
      // iOS (a bare call, plus a delayed view.focus() in a rAF — stubRAF maps
      // the rAF to a 16ms timer). The patch must force preventScroll on both.
      // (scrollIntoView: false — PM's scroll-to-selection needs getClientRects,
      // which jsdom lacks.)
      editor!.commands.focus("end", { scrollIntoView: false });
      await vi.advanceTimersByTimeAsync(32);

      const calls = focusSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) {
        expect(args[0]).toEqual(expect.objectContaining({ preventScroll: true }));
      }
      focusSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
