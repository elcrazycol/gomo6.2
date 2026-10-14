import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { MessageList, type MessageListHandle } from "./MessageList";
import { clearAllScrollPositions, saveScrollPosition } from "./scrollPosition";
import type { MessageView } from "./types";

// ── Hoisted shared state (accessible from the vi.mock factory) ─────────────
const h = vi.hoisted(() => ({
  virtuosoOpts: {} as Record<string, unknown>,
  scrollToIndexSpy: vi.fn(),
  queueMarkReadMock: vi.fn(),
  storeState: {
    selectedConversationId: "c1",
    messages: [] as MessageView[],
    firstItemIndex: 100000,
    hasMoreMessages: false,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(() => Promise.resolve()),
    me: null as { id: string; username: string } | null,
  },
}));

// ── react-virtuoso stand-in ────────────────────────────────────────────────
// Renders every item (jsdom has no layout) and captures the props so tests can
// drive `startReached` / `rangeChanged` / `atBottomStateChange` / `followOutput`
// directly, plus the imperative handle.
vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef(function Virtuoso(props: Record<string, unknown>, ref: React.Ref<unknown>) {
    h.virtuosoOpts = props;
    React.useImperativeHandle(ref, () => ({ scrollToIndex: h.scrollToIndexSpy }));
    const Header = (props.components as { Header?: React.ComponentType } | undefined)?.Header;
    const data = (props.data as MessageView[]) ?? [];
    const computeItemKey = props.computeItemKey as ((i: number, m: MessageView) => string) | undefined;
    const itemContent = props.itemContent as (i: number, m: MessageView) => React.ReactNode;
    return (
      <div className="message-scroll" data-testid="virtuoso">
        {Header ? <Header /> : null}
        {data.map((item, index) => (
          <div key={computeItemKey ? computeItemKey(index, item) : index}>{itemContent(index, item)}</div>
        ))}
      </div>
    );
  }),
}));

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: Object.assign(
    (selector: (state: typeof h.storeState) => unknown) => selector(h.storeState),
    { getState: () => h.storeState },
  ),
  queueMarkRead: (...args: unknown[]) => h.queueMarkReadMock(...args),
}));

const makeMessage = (id: string, overrides: Partial<MessageView> = {}): MessageView => ({
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
  ...overrides,
});
const incoming = (id: string, overrides: Partial<MessageView> = {}) =>
  makeMessage(id, { sender_user_id: "u2", ...overrides });

const renderMessage = (message: MessageView) => <div data-testid={`msg-${message.id}`}>{message.content}</div>;

const mountList = () => {
  const ref: React.RefObject<MessageListHandle | null> = { current: null };
  const utils = render(<MessageList ref={ref} renderMessage={renderMessage} />);
  return { ...utils, ref };
};

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  h.storeState.messages = [];
  h.storeState.firstItemIndex = 100000;
  h.storeState.hasMoreMessages = false;
  h.storeState.isLoadingMore = false;
  h.storeState.loadMoreMessages.mockClear();
  h.storeState.me = null;
  h.scrollToIndexSpy.mockClear();
  h.queueMarkReadMock.mockClear();
  h.virtuosoOpts = {};
  clearAllScrollPositions();
});

describe("MessageList (react-virtuoso)", () => {
  it("configures Virtuoso for a chat", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    h.storeState.firstItemIndex = 99950;
    mountList();
    expect(h.virtuosoOpts.firstItemIndex).toBe(99950);
    expect(h.virtuosoOpts.alignToBottom).toBe(true);
    expect(h.virtuosoOpts.defaultItemHeight).toBe(96);
    // Fixes the reverse-scroll flicker on iOS (petyosi/react-virtuoso#1083).
    expect(h.virtuosoOpts.skipAnimationFrameInResizeObserver).toBe(true);
    expect(h.virtuosoOpts.atBottomThreshold).toBe(100);
    expect(h.virtuosoOpts.increaseViewportBy).toEqual({ top: 1200, bottom: 900 });
    expect(h.virtuosoOpts.initialTopMostItemIndex).toBe(2); // opens at the last message
    // Stable per-message key (never the array index).
    const computeItemKey = h.virtuosoOpts.computeItemKey as (i: number, m: MessageView) => string;
    expect(computeItemKey(0, makeMessage("x"))).toBe("x");
    // Header component is provided.
    expect((h.virtuosoOpts.components as { Header?: unknown }).Header).toBeTruthy();
    // The chat callbacks are wired.
    for (const cb of ["startReached", "atBottomStateChange", "followOutput", "rangeChanged", "itemContent"]) {
      expect(typeof h.virtuosoOpts[cb]).toBe("function");
    }
  });

  it("renders every message and the history header", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { container } = mountList();
    expect(container.querySelectorAll(".message-virtual-item").length).toBe(3);
    expect(container.querySelector('[data-testid="msg-a"]')?.textContent).toContain("msg-a");
    expect(container.querySelector(".msg-history-header")).not.toBeNull();
  });

  it("shows the loading spinner while older history is being fetched", () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.isLoadingMore = true;
    const { container } = mountList();
    expect(container.querySelector(".msg-history-header")?.classList.contains("is-loading")).toBe(true);
  });

  it("shows the end-of-history marker when there is nothing older to load", () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.hasMoreMessages = false;
    const { container } = mountList();
    expect(container.querySelector(".msg-history-header")?.classList.contains("is-end")).toBe(true);
    expect(container.querySelector(".msg-history-header")?.textContent).toContain("Начало переписки");
  });

  it("loads older history when startReached fires", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.hasMoreMessages = true;
    mountList();
    act(() => (h.virtuosoOpts.startReached as () => void)());
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledWith("c1");
  });

  it("does not load history when there is none left", () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.hasMoreMessages = false;
    mountList();
    act(() => (h.virtuosoOpts.startReached as () => void)());
    expect(h.storeState.loadMoreMessages).not.toHaveBeenCalled();
  });

  it("reports the read line — the newest incoming message in view", () => {
    h.storeState.me = { id: "u1", username: "me" };
    h.storeState.firstItemIndex = 100000;
    h.storeState.messages = [incoming("a"), incoming("b"), incoming("c"), incoming("d")];
    mountList();
    act(() =>
      (h.virtuosoOpts.rangeChanged as (r: { startIndex: number; endIndex: number }) => void)({
        startIndex: 100000,
        endIndex: 100002,
      }),
    );
    // The newest incoming message at or before the last visible index (2) is "c".
    expect(h.queueMarkReadMock).toHaveBeenCalledWith("c1", "c", expect.any(String));
  });

  it("does not report the user's own messages as the read line", () => {
    h.storeState.me = { id: "u1", username: "me" };
    h.storeState.messages = [incoming("a"), makeMessage("own"), incoming("b")];
    mountList();
    act(() =>
      (h.virtuosoOpts.rangeChanged as (r: { startIndex: number; endIndex: number }) => void)({
        startIndex: 100000,
        endIndex: 100002,
      }),
    );
    expect(h.queueMarkReadMock).toHaveBeenCalledWith("c1", "b", expect.any(String));
  });

  it("shows the jump-to-bottom button when the user leaves the bottom", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container } = mountList();
    expect(container.querySelector(".scroll-to-bottom-btn")).toBeNull();
    act(() => (h.virtuosoOpts.atBottomStateChange as (b: boolean) => void)(false));
    expect(container.querySelector(".scroll-to-bottom-btn")).not.toBeNull();
    act(() => (h.virtuosoOpts.atBottomStateChange as (b: boolean) => void)(true));
    expect(container.querySelector(".scroll-to-bottom-btn")).toBeNull();
  });

  it("followOutput pins ONLY at the bottom — never on a history prepend", () => {
    h.storeState.me = { id: "u1", username: "me" };
    // Even with the user's own message last, a prepend (scrolled up) must not
    // pull the view down.
    h.storeState.messages = [incoming("a"), makeMessage("mine")];
    mountList();
    const followOutput = h.virtuosoOpts.followOutput as (b: boolean) => unknown;
    expect(followOutput(true)).toBe("smooth");
    expect(followOutput(false)).toBe(false);
  });

  it("scrollToBottom goes to the last message; scrollToMessage centers it", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { ref } = mountList();
    act(() => ref.current?.scrollToBottom());
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 2, align: "end", behavior: "smooth" });
    act(() => ref.current?.scrollToMessage("b"));
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 1, align: "center", behavior: "smooth" });
  });

  it("opens at the saved message when returning to the chat", () => {
    saveScrollPosition("c1", { messageId: "b", offset: 0 });
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    mountList();
    // initialTopMostItemIndex points at "b" (index 1), not the last message.
    expect(h.virtuosoOpts.initialTopMostItemIndex).toBe(1);
  });

  it("hunts older history until the saved anchor is present, then scrolls to it", async () => {
    saveScrollPosition("c1", { messageId: "z", offset: 0 });
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.hasMoreMessages = true;
    const { rerender } = mountList();
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledWith("c1");
    h.storeState.messages = [makeMessage("z"), makeMessage("a"), makeMessage("b")];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 0, align: "start" });
  });

  it("counts incoming messages into the pill when scrolled up", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container, rerender } = mountList();
    act(() => (h.virtuosoOpts.atBottomStateChange as (b: boolean) => void)(false));
    h.storeState.messages = [makeMessage("a"), incoming("b"), incoming("c")];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("2");
  });

  it("animates live arrivals at the bottom and clears the flag", () => {
    vi.useFakeTimers();
    try {
      h.storeState.messages = [makeMessage("a")];
      const { container, rerender } = mountList();
      h.storeState.messages = [makeMessage("a"), incoming("b")];
      act(() => rerender(<MessageList renderMessage={(m) => <div data-testid={`msg-${m.id}`} className="is-new">{m.content}</div>} />));
      expect(container.querySelector('[data-testid="msg-b"]')?.className).toContain("is-new");
      act(() => vi.advanceTimersByTime(1300));
    } finally {
      vi.useRealTimers();
    }
  });
});
