import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { MessageList, type MessageListHandle } from "./MessageList";
import type { MessageView } from "./types";

// ── Hoisted shared state (accessible from vi.mock factories) ──────────────
const h = vi.hoisted(() => ({
  virtuosoProps: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  scrollToIndexSpy: vi.fn(),
  storeState: {
    selectedConversationId: "c1",
    messages: [] as MessageView[],
    openingUnreadCount: 0,
    isMessagesLoading: false,
    hasMoreMessages: false,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(),
  },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────
// A minimal Virtuoso stand-in: captures its props, wires the scroller ref,
// renders every item via itemContent and the Footer component. Enough to
// exercise MessageList's own scroll logic deterministically.
vi.mock("react-virtuoso", () => {
  const Virtuoso = React.forwardRef(function VirtuosoMock(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    h.virtuosoProps = props;
    // Expose the imperative handle so the unread-boundary re-anchor
    // (virtuosoRef.current?.scrollToIndex) is observable in tests.
    if (typeof ref === "object" && ref !== null) {
      (ref as { current: { scrollToIndex: typeof h.scrollToIndexSpy } | null }).current = {
        scrollToIndex: h.scrollToIndexSpy,
      };
    }
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
  });
  return { Virtuoso };
});

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
  h.storeState.isMessagesLoading = false;
  h.scrollToIndexSpy.mockClear();
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

  it("opens on the unread boundary and re-anchors it to the network snapshot, not the stale cache", async () => {
    // First open after a reload: the message array is the IndexedDB cache,
    // which lags the network by the newest messages. The initial paint uses
    // the cache as a rough anchor, and once the network load finishes the
    // boundary is recomputed against the authoritative snapshot — a boundary
    // taken from the cache (length - unread) would land above the real first
    // unread and hide the newest messages below the fold.
    h.storeState.openingUnreadCount = 2;
    h.storeState.isMessagesLoading = true;
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { rerender } = mountList();

    // First paint: boundary from the array in hand (the cache): 3 - 2 = 1.
    expect(h.virtuosoProps.initialTopMostItemIndex).toEqual({ index: 1, align: "start" });
    expect(h.virtuosoProps.alignToBottom).toBe(false);

    // The network finishes, with the 2 unread messages the cache lacked.
    h.storeState.isMessagesLoading = false;
    h.storeState.messages = [
      makeMessage("a"),
      makeMessage("b"),
      makeMessage("c"),
      makeMessage("d"),
      makeMessage("e"),
    ];
    await act(async () => {
      rerender(<MessageList onBack={() => undefined} renderMessage={renderMessage} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Re-anchored to the network snapshot: 5 - 2 = 3.
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 3, align: "start", behavior: "auto" });
  });

  it("opens at the very bottom for a read conversation and re-pins as late media grows the list", async () => {
    // Virtuoso's initial align-end uses height estimates (64px/item); with
    // tall content (images) it stops ABOVE the real bottom, and its first
    // scroll event reads as "scrolled up" even though the user never
    // scrolled. The mount settle must ignore that transient flag, clamp to
    // the true bottom, and keep re-clamping while late media (blob previews
    // decoded with retries) grows the list. The old settle died on the
    // transient flag and left the view a couple of messages above the tail
    // on every open — the reported "~2 messages above the last" bug.
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller } = mountList();

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    const scrollToSpy = vi.fn();
    scroller.scrollTo = ((options: { top?: number }) => {
      if (typeof options?.top === "number") {
        Object.defineProperty(scroller, "scrollTop", { configurable: true, value: options.top });
      }
      scrollToSpy(options);
    }) as unknown as typeof scroller.scrollTo;

    // The transient "scrolled up" position Virtuoso lands on for tall
    // content (distance 1000 - 300 - 400 = 300 > 128px).
    await act(async () => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 300 });
      scroller.dispatchEvent(new Event("scroll"));
    });

    // Late media grows the list well past the first clamps.
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1400 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    // The settle survived the transient flag and pinned the view to the true
    // bottom (1400 - 400 = 1000), exactly like the FAB.
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 1000, behavior: "auto" }));

    // Late media keeps growing the list AFTER the first clamps. Content
    // below the fold grows without a scroll event (scrollTop stays put), so
    // the settle's checkpoints must re-pin to the new bottom instead of
    // leaving the view a couple of messages above the tail — the reported
    // "opens ~2 messages above the last, every time" bug. The mount settle
    // must still be alive here (it does not die after a few clamps, and it
    // ignores scrolled-up-looking scroll events).
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1600 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 1200, behavior: "auto" }));
  });

  it("does not yank the user when they scroll up during an append follow-settle", async () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { scroller, rerender } = mountList();

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    const scrollToSpy = vi.fn();
    scroller.scrollTo = ((options: { top?: number }) => {
      if (typeof options?.top === "number") {
        Object.defineProperty(scroller, "scrollTop", { configurable: true, value: options.top });
      }
      scrollToSpy(options);
      scroller.dispatchEvent(new Event("scroll"));
    }) as unknown as typeof scroller.scrollTo;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    scrollToSpy.mockClear();

    // A new message arrives while the user is at the bottom — the append
    // follow-settle takes over (replacing the mount settle).
    h.storeState.messages = [...h.storeState.messages, makeMessage("c")];
    await act(async () => {
      rerender(<MessageList onBack={() => undefined} renderMessage={renderMessage} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    scrollToSpy.mockClear();

    // The user scrolls up 100px: the settle must cancel (decrease-cancel in
    // handleScroll, plus the scrolled-up gate) instead of clamping them back
    // down on its next checkpoint/frame.
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 500 });
    scroller.dispatchEvent(new Event("scroll"));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
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
    // Realistic scroller: a clamp updates scrollTop and fires a scroll event
    // (handleScroll then tracks lastScrollTopRef, like a real browser).
    scroller.scrollTo = ((options: { top?: number }) => {
      if (typeof options?.top === "number") {
        Object.defineProperty(scroller, "scrollTop", { configurable: true, value: options.top });
      }
      scrollToSpy(options);
      scroller.dispatchEvent(new Event("scroll"));
    }) as unknown as typeof scroller.scrollTo;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    scrollToSpy.mockClear();

    // Simulate the user reading history: fire a scroll event far from the
    // bottom (distance 1000 - 300 - 400 = 300px > 128px → isScrolledUpRef
    // flips to true, which also makes any still-active settle bail out).
    await act(async () => {
      Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 300 });
      scroller.dispatchEvent(new Event("scroll"));
    });

    h.storeState.messages = [...h.storeState.messages, makeMessage("c")];
    await act(async () => {
      rerender(<MessageList onBack={() => undefined} renderMessage={renderMessage} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
