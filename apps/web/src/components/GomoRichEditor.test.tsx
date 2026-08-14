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
