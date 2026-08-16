import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { MessageList, type MessageListHandle } from "./MessageList";
import type { MessageView } from "./types";

// ── Hoisted shared state (accessible from vi.mock factories) ──────────────
const h = vi.hoisted(() => ({
  virtualizerOpts: {} as Record<string, unknown>,
  scrollToIndexSpy: vi.fn(),
  storeState: {
    selectedConversationId: "c1",
    messages: [] as MessageView[],
    openingUnreadCount: 0,
    isMessagesLoading: false,
    hasMoreMessages: false,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(() => Promise.resolve()),
  },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────
// A minimal useVirtualizer stand-in: captures its options (so the tests can
// assert count/getItemKey/overscan/estimateSize) and synthesizes virtual rows
// for every message. measureElement is a no-op ref callback.
vi.mock("@tanstack/react-virtual", () => {
  return {
    useVirtualizer: (opts: Record<string, unknown>) => {
      h.virtualizerOpts = opts;
      const count = (opts.count as number) ?? 0;
      return {
        getVirtualItems: () =>
          Array.from({ length: count }, (_, index) => ({
            index,
            key: index,
            start: index * 72,
            size: 72,
            end: (index + 1) * 72,
          })),
        getTotalSize: () => count * 72,
        measureElement: () => undefined,
        scrollToIndex: h.scrollToIndexSpy,
      };
    },
  };
});

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: Object.assign(
    (selector: (state: typeof h.storeState) => unknown) => selector(h.storeState),
    { getState: () => h.storeState },
  ),
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

const renderMessage = (message: MessageView) => <div data-testid={`msg-${message.id}`}>{message.content}</div>;

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
  const state = {
    scrollHeight: opts.scrollHeight ?? 0,
    scrollTop: opts.scrollTop ?? 0,
    clientHeight: opts.clientHeight ?? 0,
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
  h.storeState.openingUnreadCount = 0;
  h.storeState.isMessagesLoading = false;
  h.storeState.isLoadingMore = false;
  h.storeState.hasMoreMessages = false;
  h.storeState.loadMoreMessages.mockClear();
  h.scrollToIndexSpy.mockClear();
  h.virtualizerOpts = {};
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

  it("pins the view to the bottom while at the bottom when content grows", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 216, scrollTop: 216, clientHeight: 400 });
    // A message arrives while the user is at the bottom (isAtBottomRef starts true).
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c"), makeMessage("d")];
    metrics.scrollHeight = 288; // the browser content grew
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(metrics.scrollTop).toBe(288);
  });

  it("compensates scrollTop when older messages are prepended while scrolled up", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { scroller, rerender } = mountList();
    const metrics = stubScroller(scroller, { scrollHeight: 2000, scrollTop: 500, clientHeight: 400 });
    // The user scrolled away from the bottom.
    scrollScroller(scroller);
    expect(h.storeState.loadMoreMessages).not.toHaveBeenCalled();

    // History is prepended; the browser content grows by the prepended height.
    h.storeState.messages = [makeMessage("x"), makeMessage("y"), makeMessage("a"), makeMessage("b"), makeMessage("c")];
    metrics.scrollHeight = 2000 + 144;
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
});
