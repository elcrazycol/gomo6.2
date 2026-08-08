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
    });      // scrollHeight(500) - clientHeight(400) = maxScrollTop(100)
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 100, behavior: "auto" }));
  });

  it("holds the follow-scroll until the appended item is measured (single exact scroll, no twitch)", async () => {
    // Manual rAF pump so the height change can land between the settle's
    // stability checks, exactly as the measurement lands in a real browser.
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const pumpFrames = async (count: number) => {
      for (let i = 0; i < count; i += 1) {
        const cb = rafQueue.shift();
        if (cb) cb(0);
        await Promise.resolve();
      }
    };

    try {
      h.storeState.messages = [makeMessage("a"), makeMessage("b")];
      const { scroller, rerender } = mountList();

      Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 500 });
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 100 });
      const scrollToSpy = vi.fn();
      scroller.scrollTo = ((options: { top?: number }) => {
        if (typeof options?.top === "number") {
          Object.defineProperty(scroller, "scrollTop", { configurable: true, value: options.top });
        }
        scrollToSpy(options);
      }) as unknown as typeof scroller.scrollTo;

      // Drain the mount-time settle's frame chain. The view sits exactly at
      // the bottom (500 − 100 − 400 = 0), so it must not scroll at all.
      await act(async () => {
        await pumpFrames(30);
      });
      expect(scrollToSpy).not.toHaveBeenCalled();

      // Append while at the bottom. The new item first renders at the default
      // height estimate, growing the list (scrollHeight 600 → maxScrollTop
      // 200); only later is it measured to its real size (800 → maxScrollTop
      // 400). Scrolling to the estimate would produce the twitch/gap.
      Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 600 });
      h.storeState.messages = [...h.storeState.messages, makeMessage("c")];
      await act(async () => {
        rerender(<MessageList onBack={() => undefined} renderMessage={renderMessage} />);
        // Yield to a macrotask so React flushes the append effect (which
        // schedules the settle) before we start pumping its frames.
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // First settle frame sees the ESTIMATE height. The wait phase must
      // hold here — a naive settle would already scroll to the estimate
      // bottom (200) on this frame.
      await act(async () => {
        await pumpFrames(1);
      });
      expect(scrollToSpy).not.toHaveBeenCalled();

      // The measurement lands before the second stability check. The settle
      // must scroll exactly once — to the measured bottom (400), never the
      // estimate (200).
      Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 800 });
      await act(async () => {
        await pumpFrames(4);
      });
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
      expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 400, behavior: "auto" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels the follow-settle the moment the user scrolls up (no jitter/fight)", async () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller } = mountList();

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    const scrollToSpy = vi.fn();
    scroller.scrollTo = scrollToSpy;

    // The mount settle clamps the view to the bottom (scrollTop 600).
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 600 });
    scroller.dispatchEvent(new Event("scroll"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    scrollToSpy.mockClear();

    // The user scrolls UP (scrollTop 500). The active settle must cancel
    // instead of pulling the view back down on its next checkpoint.
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 500 });
    scroller.dispatchEvent(new Event("scroll"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
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
