import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { MessageList, type MessageListHandle } from "./MessageList";
import type { MessageView } from "./types";

// ── Hoisted shared state (accessible from vi.mock factories) ──────────────
const h = vi.hoisted(() => ({
  virtuosoProps: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  storeState: {
    selectedConversationId: "c1",
    messages: [] as MessageView[],
    openingUnreadCount: 0,
    hasMoreMessages: false,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(),
  },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────
// A minimal Virtuoso stand-in: captures its props, wires the scroller ref,
// renders every item via itemContent and the Footer component. Enough to
// exercise MessageList's own scroll logic deterministically.
vi.mock("react-virtuoso", () => ({
  Virtuoso: (props: Record<string, unknown>) => {
    h.virtuosoProps = props;
    const scrollerRef = props.scrollerRef as ((el: HTMLDivElement | null) => void) | undefined;
    const itemContent = props.itemContent as (index: number) => React.ReactNode;
    const computeItemKey = props.computeItemKey as ((index: number) => unknown) | undefined;
    const components = props.components as {
      Scroller?: React.ComponentType<React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>>;
      List?: React.ComponentType<{ style?: React.CSSProperties; children?: React.ReactNode }>;
      Footer?: React.ComponentType;
    };
    // Use MessageList's REAL Scroller/List components so the scroll-event
    // handlers (handleScroll, wheel/touch cancel) are actually wired up — a
    // plain div would bypass them and the test would not reflect reality.
    const Scroller = components?.Scroller;
    const List = components?.List;
    const Footer = components?.Footer;
    const items = Array.from({ length: props.totalCount as number }, (_, index) => (
      <div key={(computeItemKey?.(index) ?? index) as React.Key}>{itemContent(index)}</div>
    ));
    return Scroller && List ? (
      <Scroller ref={(el: HTMLDivElement | null) => scrollerRef?.(el)} style={{ height: "100%" }}>
        <List>{items}</List>
        {Footer ? <Footer /> : null}
      </Scroller>
    ) : null;
  },
}));

vi.mock("@use-gesture/react", () => ({
  useDrag: () => () => ({}),
}));

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
  const utils = render(<MessageList onBack={() => undefined} ref={ref} renderMessage={renderMessage} />);
  const scroller = utils.container.querySelector(".message-scroll") as HTMLDivElement | null;
  if (!scroller) throw new Error("scroller not rendered");
  return { ...utils, scroller, ref };
};

// jsdom has no rAF; run callbacks via macrotask so the settle loop can flush.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  h.storeState.messages = [];
  h.storeState.openingUnreadCount = 0;
  h.virtuosoProps = {};
});

describe("MessageList scroll behavior", () => {
  it("renders the bottom gap footer element", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container } = mountList();
    expect(container.querySelector(".message-list-footer")).not.toBeNull();
  });

  it("disables Virtuoso's built-in followOutput", () => {
    h.storeState.messages = [makeMessage("a")];
    mountList();
    expect(h.virtuosoProps.followOutput).toBe(false);
  });

  it("scrolls the scroller to the true bottom when a new message is appended while at the bottom", async () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller, rerender } = mountList();

    // Give the mount-time settle a chance to run, then reset the spy.
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    const scrollToSpy = vi.fn();
    scroller.scrollTo = scrollToSpy;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    scrollToSpy.mockClear();

    // Append a message from the interlocutor while the view is at the bottom.
    h.storeState.messages = [...h.storeState.messages, makeMessage("c")];
    await act(async () => {
      rerender(<MessageList onBack={() => undefined} renderMessage={renderMessage} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // scrollHeight(500) - clientHeight(400) = maxScrollTop(100)
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 100, behavior: "auto" }));
  });

  it("does not scroll (and does not yank the user) when the append happens while scrolled up", async () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller, rerender } = mountList();

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    const scrollToSpy = vi.fn();
    scroller.scrollTo = scrollToSpy;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    scrollToSpy.mockClear();

    // Simulate the user reading history: fire a scroll event far from the
    // bottom (distance 1000 - 300 - 400 = 300px > 128px → isScrolledUpRef
    // flips to true, which also makes any still-active settle bail out).
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 300 });
    scroller.dispatchEvent(new Event("scroll"));

    h.storeState.messages = [...h.storeState.messages, makeMessage("c")];
    await act(async () => {
      rerender(<MessageList onBack={() => undefined} renderMessage={renderMessage} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
