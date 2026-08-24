import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { MessageList, type MessageListHandle } from "./MessageList";
import { clearAllScrollPositions, getScrollPosition, saveScrollPosition } from "./scrollPosition";
import type { MessageView } from "./types";

// ── Hoisted shared state (accessible from vi.mock factories) ──────────────
const h = vi.hoisted(() => ({
  virtualizerOpts: {} as Record<string, unknown>,
  scrollToIndexSpy: vi.fn(),
  queueMarkReadMock: vi.fn(),
  isScrolling: false,
  // Simulates the virtualizer's ResizeObserver output: the real one updates
  // `scrollRect` (and re-renders) whenever the scroller is resized — e.g. when
  // an interactive-widget=resizes-content keyboard shrinks the message shell.
  // The MessageList pin effect listens to `scrollRect.height` for exactly this
  // signal, so tests drive the re-pin by mutating this value + rerendering.
  mockScrollRectHeight: 400,
  storeState: {
    selectedConversationId: "c1",
    conversations: [] as Array<{ id: string; is_group?: boolean }>,
    messages: [] as MessageView[],
    openingUnreadCount: 0,
    isMessagesLoading: false,
    hasMoreMessages: false,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(() => Promise.resolve()),
    me: null as { id: string; username: string } | null,
  },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────
// A minimal useVirtualizer stand-in: captures its options (so the tests can
// assert count/getItemKey/overscan/estimateSize) and synthesizes virtual rows
// for every message. measureElement is a no-op ref callback. The instance is
// cached per `count` (like the real hook's stable instance) so components can
// list `virtualizer` as an effect dependency without re-running on every
// render.
vi.mock("@tanstack/react-virtual", () => {
  // Cached per (count, isScrolling): the real virtualizer re-measures when the
  // scroll state changes, which swaps the instance. Mirroring that lets the
  // MessageList layout effect re-run the moment a gesture settles.
  const instances = new Map<string, Record<string, unknown>>();
  return {
    useVirtualizer: (opts: Record<string, unknown>) => {
      h.virtualizerOpts = opts;
      const count = (opts.count as number) ?? 0;
      const key = `${count}:${h.isScrolling}`;
      let instance = instances.get(key);
      if (!instance) {
        instance = {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 72,
              size: 72,
              end: (index + 1) * 72,
            })),
          getTotalSize: () => count * 72,
          getOffsetForIndex: (index: number) => [index * 72, "start"] as const,
          measureElement: () => undefined,
          scrollToIndex: h.scrollToIndexSpy,
          get isScrolling() {
            return h.isScrolling;
          },
          // Mirror the real instance's reactive `scrollRect` (updated by its
          // ResizeObserver on the scroller and surfaced via maybeNotify()).
          get scrollRect() {
            return { height: h.mockScrollRectHeight, top: 0, left: 0, width: 0 };
          },
        };
        instances.set(key, instance);
      }
      return instance;
    },
  };
});

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: Object.assign(
    (selector: (state: typeof h.storeState) => unknown) => selector(h.storeState),
    { getState: () => h.storeState },
  ),
  queueMarkRead: (...args: unknown[]) => h.queueMarkReadMock(...args),
}));

const makeMessage = (id: string): MessageView => ({
  id,
  conversation_id: "c1",
  sender_user_id: "u1",
  parent_message_id: null,
  content: `msg-${id}`,
  is_edited: false,
  is_deleted: false,
  edited_at: null,
  sent_at: "2026-08-08T12:00:00.000Z",
  client_id: id,
});

// Messages from the other side of the chat (read receipts only matter for
// other users' messages).
const makeIncomingMessage = (id: string): MessageView => ({ ...makeMessage(id), sender_user_id: "u2" });

const renderMessage = (message: MessageView) => <div data-testid={`msg-${message.id}`}>{message.content}</div>;

const renderMessageWithNewFlag = (message: MessageView, _prev: MessageView | null, extras: { isNew: boolean }) =>
  <div data-testid={`msg-${message.id}`} className={extras.isNew ? "is-new-wrapper" : ""}>{message.content}</div>;

const mountList = () => {
  const ref: React.RefObject<MessageListHandle | null> = { current: null };
  const utils = render(<MessageList ref={ref} renderMessage={renderMessage} />);
  const scroller = utils.container.querySelector(".message-scroll") as HTMLDivElement | null;
  if (!scroller) throw new Error("scroller not rendered");
  return { ...utils, scroller, ref };
};

// jsdom has no layout engine: scrollHeight/clientHeight are always 0 and
// scrollTop is a plain property. Stub them with a mutable fake so the
// scroll/anchor logic is exercised deterministically.
const stubScroller = (
  scroller: HTMLElement,
  opts: { scrollHeight?: number; scrollTop?: number; clientHeight?: number } = {},
) => {
  // Capture the element's current value first: layout effects (bottom pin,
  // anchor restore) run during mount, so by the time the stub is installed the
  // scrollTop may already be meaningful.
  const state = {
    scrollHeight: opts.scrollHeight ?? scroller.scrollHeight,
    scrollTop: opts.scrollTop ?? scroller.scrollTop,
    clientHeight: opts.clientHeight ?? scroller.clientHeight,
  };
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => state.scrollHeight });
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => state.scrollTop,
    set: (v: number) => {
      state.scrollTop = v;
    },
  });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => state.clientHeight });
  return state;
};

const scrollScroller = (scroller: HTMLElement) =>
  act(() => {
    fireEvent.scroll(scroller);
  });



beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  h.storeState.messages = [];
  h.storeState.conversations = [];
  h.storeState.openingUnreadCount = 0;
  h.storeState.isMessagesLoading = false;
  h.storeState.isLoadingMore = false;
  h.storeState.hasMoreMessages = false;
  h.storeState.loadMoreMessages.mockClear();
  h.storeState.me = null;
  h.scrollToIndexSpy.mockClear();
  h.queueMarkReadMock.mockClear();
  h.virtualizerOpts = {};
  h.isScrolling = false;
  h.mockScrollRectHeight = 400;
  clearAllScrollPositions();
});

describe("MessageList virtualization", () => {
  it("configures the virtualizer per the spec", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    mountList();
    expect(h.virtualizerOpts.count).toBe(3);
    // getItemKey is strictly the message identity (client_id || id).
    const getItemKey = h.virtualizerOpts.getItemKey as (index: number) => unknown;
    expect(getItemKey(0)).toBe("a");
    expect(getItemKey(2)).toBe("c");
    // overscan: ТЗ requires 8–15 items.
    expect(h.virtualizerOpts.overscan).toBeGreaterThanOrEqual(8);
    expect(h.virtualizerOpts.overscan).toBeLessThanOrEqual(15);
    // estimateSize returns a sane positive number.
    const estimateSize = h.virtualizerOpts.estimateSize as (index: number) => number;
    expect(estimateSize(0)).toBeGreaterThan(0);
    expect(estimateSize(1)).toBeGreaterThan(0);
    // getScrollElement returns the scroller element.
    const getScrollElement = h.virtualizerOpts.getScrollElement as () => HTMLElement | null;
    expect(getScrollElement()?.classList.contains("message-scroll")).toBe(true);
  });

  it("renders every virtual item with its message content", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { container } = mountList();
    expect(container.querySelectorAll(".message-virtual-item").length).toBe(3);
    expect(container.querySelector('[data-index="0"]')?.textContent).toContain("msg-a");
    expect(container.querySelector('[data-index="2"]')?.textContent).toContain("msg-c");
  });

  it("renders the bottom gap and the history header", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container } = mountList();
    expect(container.querySelector(".message-list-footer")).not.toBeNull();
    expect(container.querySelector(".msg-history-header")).not.toBeNull();
  });

  it("shows the history loader while older messages are being fetched", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.isLoadingMore = true;
    const { container } = mountList();
    expect(container.querySelector(".msg-history-header")?.classList.contains("is-loading")).toBe(true);
    expect(container.querySelector(".msg-history-loader")).not.toBeNull();
  });

  it("shows the end-of-history marker when there is nothing older to load", () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.hasMoreMessages = false;
    const { container } = mountList();
    const header = container.querySelector(".msg-history-header");
    expect(header?.classList.contains("is-end")).toBe(true);
    expect(header?.textContent).toContain("Начало переписки");
  });

  it("loads older history when scrolled near the top", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller, rerender } = mountList();
    stubScroller(scroller, { scrollHeight: 2000, scrollTop: 0, clientHeight: 400 });
    h.storeState.hasMoreMessages = true;
    rerender(<MessageList renderMessage={renderMessage} />);
    scrollScroller(scroller);
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledWith("c1");
  });

  it("does not load history while scrolled down", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.hasMoreMessages = true;
    const { scroller } = mountList();
    stubScroller(scroller, { scrollHeight: 2000, scrollTop: 1500, clientHeight: 400 });
    scrollScroller(scroller);
    expect(h.storeState.loadMoreMessages).not.toHaveBeenCalled();
  });

  it("does not fire duplicate history loads while one is in flight", async () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.hasMoreMessages = true;
    let resolveLoad: (() => void) | undefined;
    h.storeState.loadMoreMessages.mockReturnValue(new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    const { scroller } = mountList();
    stubScroller(scroller, { scrollHeight: 2000, scrollTop: 0, clientHeight: 400 });
    scrollScroller(scroller);
    scrollScroller(scroller);
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledTimes(1);
    resolveLoad?.();
  });

  it("does not fight an active scroll gesture — no scrollTop writes while isScrolling", () => {
    const base = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`));
    h.storeState.messages = base;
    const { scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 766, scrollTop: 366, clientHeight: 400 });
    // The user is mid-gesture (touch/momentum) when a message arrives.
    h.isScrolling = true;
    h.storeState.messages = [...base, makeMessage("new")];
    metrics.scrollHeight = 766 + 72;
    rerender(<MessageList renderMessage={renderMessage} />);
    // No clamp mid-gesture — the JS must not race the browser's scrolling.
    expect(metrics.scrollTop).toBe(366);
    // The gesture settles; the pin re-applies and clamps to the new bottom.
    // A fresh renderMessage reference forces the re-render (like the real
    // store re-render on isScrolling change) — the instance survives, so
    // isAtBottomRef is preserved.
    h.isScrolling = false;
    rerender(<MessageList renderMessage={(m) => renderMessage(m)} />);
    expect(metrics.scrollTop).toBe(766 + 72 - 400);
  });

  it("yields the bottom pin to a pointerdown before the first scroll event", () => {
    const base = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`));
    h.storeState.messages = base;
    const { scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 766, scrollTop: 366, clientHeight: 400 });
    // Finger lands on the list, then a message arrives before any scroll event.
    fireEvent.pointerDown(scroller);
    h.storeState.messages = [...base, makeMessage("new")];
    metrics.scrollHeight = 766 + 72;
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(metrics.scrollTop).toBe(366);
    fireEvent.pointerUp(scroller);
  });

  it("estimates date separators and quoted replies in item heights", () => {
    h.storeState.messages = [
      makeMessage("first"), // prev = null → date separator above
      makeMessage("second"), // same day → no separator
      { ...makeMessage("quoted"), parent_message_id: "first", content: "quote me" },
    ];
    mountList();
    const estimateSize = h.virtualizerOpts.estimateSize as (index: number) => number;
    const first = estimateSize(0);
    const second = estimateSize(1);
    const quoted = estimateSize(2);
    // Separator ~34px above the first message of the day.
    expect(first - second).toBe(34);
    // Quoted reply ~34px above the bubble.
    expect(quoted - second).toBe(34);
  });

  it("estimates gift cards at their fixed standalone height", () => {
    h.storeState.messages = [
      { ...makeMessage("gift"), content: "__GIFT__:g1:Gift:img.jpg" },
    ];
    mountList();
    const estimateSize = h.virtualizerOpts.estimateSize as (index: number) => number;
    expect(estimateSize(0)).toBe(190);
  });

  it("pins the view to the bottom while at the bottom when content grows", () => {
    const base = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`));
    h.storeState.messages = base;
    const { scroller, rerender } = mountList();
    // 34 (header) + 10*72 + 12 (gap) = 766 content; viewport 400 → bottom = 366.
    const metrics = stubScroller(scroller, { scrollHeight: 766, scrollTop: 366, clientHeight: 400 });
    // A message arrives while the user is at the bottom (isAtBottomRef starts true).
    h.storeState.messages = [...base, makeMessage("new")];
    metrics.scrollHeight = 766 + 72; // the browser content grew
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(metrics.scrollTop).toBe(766 + 72 - 400);
  });

  it("keeps the view anchored when older messages are prepended while scrolled up", () => {
    const base = Array.from({ length: 20 }, (_, i) => makeMessage(`m${i}`));
    h.storeState.messages = base;
    const { scroller, rerender } = mountList();
    // 34 (header) + 20*72 + 12 (gap) = 1486 content; scrollTop 500 is scrolled up.
    const metrics = stubScroller(scroller, { scrollHeight: 1486, scrollTop: 500, clientHeight: 400 });
    // The user scrolled away from the bottom — this captures the anchor.
    scrollScroller(scroller);
    expect(h.storeState.loadMoreMessages).not.toHaveBeenCalled();

    // History is prepended; the anchor (top-most visible message) stays frozen,
    // so scrollTop grows by exactly the prepended height (2 * 72).
    h.storeState.messages = [makeMessage("x"), makeMessage("y"), ...base];
    metrics.scrollHeight = 1486 + 144;
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(metrics.scrollTop).toBe(500 + 144);
  });

  it("does not shift the view when a message is updated in place (same first key)", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 2000, scrollTop: 700, clientHeight: 400 });
    scrollScroller(scroller);
    h.storeState.messages = [
      { ...makeMessage("a"), content: "edited" },
      makeMessage("b"),
    ];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(metrics.scrollTop).toBe(700);
  });

  it("scrollToBottom jumps to the true bottom (smooth)", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { ref, scroller } = mountList();
    const scrollToSpy = vi.fn();
    scroller.scrollTo = scrollToSpy;
    act(() => {
      ref.current?.scrollToBottom();
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "smooth" });
  });

  it("scrollToMessage centers the requested message", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { ref } = mountList();
    act(() => {
      ref.current?.scrollToMessage("b");
    });
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith(1, { align: "center" });
  });

  it("restores the saved scroll position when returning to the chat", () => {
    // The user left this conversation with message "b" 20px below the top of
    // the viewport (top of the list is HISTORY_HEADER_HEIGHT 34 + row.start).
    saveScrollPosition("c1", { messageId: "b", offset: 20 });
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { container, scroller } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 216, clientHeight: 400 });
    // 34 (header) + 72 (row b) + 20 (offset) = 126.
    expect(metrics.scrollTop).toBe(126);
    // The user is not at the bottom, so the FAB is visible.
    expect(container.querySelector(".scroll-to-bottom-btn")).not.toBeNull();
  });

  it("auto-loads history until the saved anchor message is present", () => {
    saveScrollPosition("c1", { messageId: "z", offset: 0 });
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    h.storeState.hasMoreMessages = true;
    const { scroller, rerender } = mountList();
    // The anchor is not in the first batch — history must be requested.
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledWith("c1");
    const metrics = stubScroller(scroller, { scrollHeight: 288, clientHeight: 400 });

    // The older page arrives with the anchor prepended.
    h.storeState.messages = [makeMessage("z"), makeMessage("a"), makeMessage("b"), makeMessage("c")];
    rerender(<MessageList renderMessage={renderMessage} />);
    // Jumps to message "z" at the top: 34 (header) + 0 + 0 = 34.
    expect(metrics.scrollTop).toBe(34);
  });

  it("gives up hunting the anchor and opens at the bottom when history ends", () => {
    saveScrollPosition("c1", { messageId: "z", offset: 0 });
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.hasMoreMessages = false;
    const { scroller } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 144, scrollTop: 144, clientHeight: 400 });
    expect(h.storeState.loadMoreMessages).not.toHaveBeenCalled();
    // Falls back to the bottom (isAtBottomRef starts true).
    expect(metrics.scrollTop).toBe(144);
  });

  it("scrollToBottom cancels the saved position", () => {
    saveScrollPosition("c1", { messageId: "b", offset: 20 });
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { ref, scroller } = mountList();
    const scrollToSpy = vi.fn();
    scroller.scrollTo = scrollToSpy;
    act(() => {
      ref.current?.scrollToBottom();
    });
    expect(getScrollPosition("c1")).toBeUndefined();
  });
});

describe("MessageList keyboard viewport resizes", () => {
  it("re-pins to the bottom when the keyboard shrinks the scroller (Firefox on iOS / Android)", () => {
    const base = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`));
    h.storeState.messages = base;
    const { scroller, rerender } = mountList();
    // 34 (header) + 10*72 + 12 (gap) = 766 content; viewport 400 → bottom = 366.
    const metrics = stubScroller(scroller, { scrollHeight: 766, scrollTop: 366, clientHeight: 400 });
    h.mockScrollRectHeight = 400;

    // Browsers that RESIZE the layout viewport with the keyboard (Firefox on
    // iOS, Chrome/Firefox Android with interactive-widget=resizes-content):
    // the fixed panel rises natively (no --kb-inset translate — the delta
    // channel stays 0) and the scroller's clientHeight drops while the browser
    // leaves scrollTop untouched (the scroll range grew, so there is no clamp).
    // The virtualizer's ResizeObserver reports the new size as `scrollRect`,
    // which is the dep that re-runs the pin.
    metrics.clientHeight = 100;
    h.mockScrollRectHeight = 100;
    rerender(<MessageList renderMessage={renderMessage} />);

    // The bottom pin re-applies and clamps to the new bottom: 766 - 100.
    expect(metrics.scrollTop).toBe(666);
  });

  it("does not move the pin when the keyboard lifts via translate (iOS, no layout change)", () => {
    const base = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`));
    h.storeState.messages = base;
    const { scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 766, scrollTop: 366, clientHeight: 400 });
    h.mockScrollRectHeight = 400;

    // iOS: the layout never resizes — the composer-only `translate` (--kb-inset)
    // lifts the list, so the scroller stays 400 tall. A re-render with no
    // `scrollRect` change must not retrigger the pin and move the view.
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(metrics.scrollTop).toBe(366);
  });
});

describe("MessageList realtime appends", () => {
  it("shows the N-new-messages pill when a message arrives while scrolled up", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container, scroller, rerender } = mountList();
    stubScroller(scroller, { scrollHeight: 2000, scrollTop: 500, clientHeight: 400 });
    scrollScroller(scroller);

    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c"), makeMessage("d")];
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("2");
    expect(container.querySelector(".scroll-to-bottom-btn")).not.toBeNull();
  });

  it("counts only incoming messages, not the user's own optimistic ones", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container, scroller, rerender } = mountList();
    stubScroller(scroller, { scrollHeight: 2000, scrollTop: 500, clientHeight: 400 });
    scrollScroller(scroller);

    const own = makeMessage("mine");
    own.localStatus = "sending";
    h.storeState.messages = [makeMessage("a"), own, makeMessage("b")];
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("1");
  });

  it("stays quiet while at the bottom — the pin follows appends", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container, scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 144, scrollTop: 144, clientHeight: 400 });

    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    metrics.scrollHeight = 216;
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(container.querySelector(".scroll-to-bottom-btn")).toBeNull();
  });

  it("clears the pill when the user returns to the bottom", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container, scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 2000, scrollTop: 500, clientHeight: 400 });
    scrollScroller(scroller);
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("1");

    metrics.scrollTop = 1600; // back at the bottom (2000 - 1600 - 400 = 0)
    scrollScroller(scroller);
    expect(container.querySelector(".scroll-to-bottom-btn")).toBeNull();
  });

  it("animates live arrivals at the bottom and clears the flag after the animation", () => {
    vi.useFakeTimers();
    try {
      h.storeState.messages = [makeMessage("a"), makeMessage("b")];
      const { container, rerender } = mountList();
      // isAtBottomRef starts true — the arrival is visible, so it animates.
      h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
      act(() => rerender(<MessageList renderMessage={renderMessageWithNewFlag} />));
      expect(container.querySelector('[data-testid="msg-c"]')?.className).toContain("is-new-wrapper");

      // Once the entrance has played, the flag is cleared so scrolling away
      // and back never replays it.
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(container.querySelector('[data-testid="msg-c"]')?.className).not.toContain("is-new-wrapper");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not animate arrivals while scrolled up — only counts them in the pill", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container, scroller, rerender } = mountList();
    stubScroller(scroller, { scrollHeight: 2000, scrollTop: 500, clientHeight: 400 });
    scrollScroller(scroller);

    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    rerender(<MessageList renderMessage={renderMessageWithNewFlag} />);

    expect(container.querySelector('[data-testid="msg-c"]')?.className).not.toContain("is-new-wrapper");
    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("1");
  });
});

describe("MessageList read line", () => {
  // The virtualizer mock renders every item 72px tall; the history header is
  // 34px. itemBottom = 34 + (index + 1) * 72.
  it("reports ONE read line — the newest fully-visible incoming message", () => {
    h.storeState.me = { id: "u1", username: "me" };
    h.storeState.messages = [
      makeIncomingMessage("a"),
      makeIncomingMessage("b"),
      makeIncomingMessage("c"),
      makeIncomingMessage("d"),
      makeIncomingMessage("e"),
    ];
    const { scroller } = mountList();
    // Viewport bottom at 178: a (bottom 106) and b (bottom 178) fully
    // visible; c (bottom 250) and everything after are below the fold.
    stubScroller(scroller, { scrollHeight: 406, scrollTop: 34, clientHeight: 144 });
    scrollScroller(scroller);

    // Exactly one read-line request, for the newest visible message.
    expect(h.queueMarkReadMock).toHaveBeenCalledTimes(1);
    expect(h.queueMarkReadMock).toHaveBeenCalledWith("c1", "b", "2026-08-08T12:00:00.000Z");
  });

  it("keeps messages below the fold unread — never reports them", () => {
    h.storeState.me = { id: "u1", username: "me" };
    h.storeState.messages = [
      makeIncomingMessage("a"),
      makeIncomingMessage("b"),
      makeIncomingMessage("c"),
      makeIncomingMessage("d"),
      makeIncomingMessage("e"),
    ];
    const { scroller } = mountList();
    // Viewport bottom at 178 → c/d/e are below the fold and must never be
    // reported as read.
    stubScroller(scroller, { scrollHeight: 406, scrollTop: 34, clientHeight: 144 });
    scrollScroller(scroller);

    expect(h.queueMarkReadMock).toHaveBeenCalledTimes(1);
    expect(h.queueMarkReadMock).toHaveBeenCalledWith("c1", "b", expect.any(String));
    expect(h.queueMarkReadMock.mock.calls[0]![1]).not.toBe("c");
    expect(h.queueMarkReadMock.mock.calls[0]![1]).not.toBe("d");
    expect(h.queueMarkReadMock.mock.calls[0]![1]).not.toBe("e");
  });

  it("skips own messages when computing the read line", () => {
    h.storeState.me = { id: "u1", username: "me" };
    h.storeState.messages = [
      makeIncomingMessage("a"),
      makeMessage("own"), // my own message — never anchored as read line
      makeIncomingMessage("b"),
    ];
    const { scroller } = mountList();
    stubScroller(scroller, { scrollHeight: 250, scrollTop: 0, clientHeight: 400 });
    scrollScroller(scroller);

    // The newest incoming message is b, even though an own message sits
    // between a and b.
    expect(h.queueMarkReadMock).toHaveBeenCalledTimes(1);
    expect(h.queueMarkReadMock).toHaveBeenCalledWith("c1", "b", expect.any(String));
  });

  it("stays silent when no incoming message is on screen (own-only viewport)", () => {
    h.storeState.me = { id: "u1", username: "me" };
    h.storeState.messages = [makeMessage("own1"), makeMessage("own2")];
    const { scroller } = mountList();
    stubScroller(scroller, { scrollHeight: 200, scrollTop: 0, clientHeight: 400 });
    scrollScroller(scroller);

    expect(h.queueMarkReadMock).not.toHaveBeenCalled();
  });
});
