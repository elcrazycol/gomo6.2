import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { MessageList, type MessageListHandle } from "./MessageList";
import type { MessageView } from "./types";

// ── Hoisted shared state (accessible from vi.mock factories) ──────────────
const h = vi.hoisted(() => ({
  virtuosoProps: {} as Record<string, unknown>,
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
// A minimal Virtuoso stand-in: captures its props, wires the scroller ref and
// renders every item via itemContent, so MessageList's own logic (indices,
// prepends, callbacks) is exercised deterministically.
vi.mock("react-virtuoso", () => {
  const Virtuoso = React.forwardRef(function VirtuosoMock(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    h.virtuosoProps = props;
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
      Header?: React.ComponentType;
      Footer?: React.ComponentType;
    };
    const Scroller = components?.Scroller;
    const List = components?.List;
    const Header = components?.Header;
    const Footer = components?.Footer;
    const items = Array.from({ length: props.totalCount as number }, (_, index) => (
      <div key={(computeItemKey?.(index) ?? index) as React.Key}>{itemContent(index)}</div>
    ));
    return Scroller && List ? (
      <Scroller ref={(el: HTMLDivElement | null) => scrollerRef?.(el)} style={{ height: "100%" }}>
        {Header ? <Header /> : null}
        <List>{items}</List>
        {Footer ? <Footer /> : null}
      </Scroller>
    ) : null;
  });
  return { Virtuoso };
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
  h.virtuosoProps = {};
});

describe("MessageList virtualization", () => {
  it("adjusts firstItemIndex in the same render as a history prepend (no flicker frame)", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { rerender } = mountList();
    const initialIndex = h.virtuosoProps.firstItemIndex as number;
    expect(initialIndex).toBe(1_000_000);

    // Older messages are prepended (history load). The virtual index must
    // already reflect the prepend in THIS render so item windows never shift
    // for a visible frame.
    h.storeState.messages = [makeMessage("x"), makeMessage("a"), makeMessage("b")];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(h.virtuosoProps.firstItemIndex).toBe(initialIndex - 1);

    // The anchored message "a" keeps its key: its virtual index is unchanged
    // (1_000_000 before, (1_000_000 - 1) + 1 after).
    const computeItemKey = h.virtuosoProps.computeItemKey as (index: number) => unknown;
    expect(computeItemKey(initialIndex)).toBe("a");
  });

  it("shows the history loader while older messages are being fetched", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.isLoadingMore = true;
    const { container } = mountList();
    expect(container.querySelector(".msg-history-loader")).not.toBeNull();
  });

  it("hides the history loader when idle", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container } = mountList();
    expect(container.querySelector(".msg-history-loader")).toBeNull();
  });

  it("renders the bottom gap footer element", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container } = mountList();
    expect(container.querySelector(".message-list-footer")).not.toBeNull();
  });

  it("follows new messages only while the user is at the bottom (never yanks a scrolled-up reader)", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    mountList();
    const followOutput = h.virtuosoProps.followOutput as (atBottom: boolean) => boolean | string;
    expect(followOutput(true)).toBe("smooth");
    expect(followOutput(false)).toBe(false);
  });

  it("opens on the unread boundary and re-anchors it to the network snapshot, not the stale cache", async () => {
    // First open after a reload: the message array is the IndexedDB cache,
    // which lags the network by the newest messages. The initial paint uses
    // the cache as a rough anchor, and once the network load finishes the
    // boundary is recomputed against the authoritative snapshot.
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
      rerender(<MessageList renderMessage={renderMessage} />);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Re-anchored to the network snapshot: 5 - 2 = 3.
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 3, align: "start", behavior: "auto" });
  });

  it("opens at the very bottom for a read conversation (alignToBottom + initialTopMostItemIndex end)", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    mountList();
    expect(h.virtuosoProps.alignToBottom).toBe(true);
    expect(h.virtuosoProps.initialTopMostItemIndex).toEqual({ index: 1, align: "end" });
  });

  it("loads older history when the top is reached", async () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.hasMoreMessages = true;
    mountList();
    const startReached = h.virtuosoProps.startReached as () => void;
    await act(async () => {
      startReached();
      await Promise.resolve();
    });
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledWith("c1");
  });

  it("does not load history while a request is already in flight", async () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.hasMoreMessages = true;
    let resolveLoad: (() => void) | undefined;
    h.storeState.loadMoreMessages.mockReturnValue(new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    mountList();
    const startReached = h.virtuosoProps.startReached as () => void;
    await act(async () => {
      startReached();
      await Promise.resolve();
    });
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledTimes(1);
    await act(async () => {
      startReached();
      await Promise.resolve();
    });
    expect(h.storeState.loadMoreMessages).toHaveBeenCalledTimes(1);
    resolveLoad?.();
  });

  it("scrollToBottom jumps to the last message", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { ref } = mountList();
    act(() => {
      ref.current?.scrollToBottom();
    });
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 2, align: "end", behavior: "smooth" });
  });

  it("scrollToMessage centers the requested message", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const { ref } = mountList();
    act(() => {
      ref.current?.scrollToMessage("b");
    });
    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 1, align: "center", behavior: "smooth" });
  });
});

describe("MessageList realtime appends", () => {
  it("shows the N-new-messages pill when a message arrives while scrolled up", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container, rerender } = mountList();

    // The user scrolled away from the bottom.
    act(() => {
      const atBottomChange = h.virtuosoProps.atBottomStateChange as (atBottom: boolean) => void;
      atBottomChange(false);
    });

    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c"), makeMessage("d")];
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("2");
    expect(container.querySelector(".scroll-to-bottom-btn")).not.toBeNull();
  });

  it("counts only incoming messages, not the user's own optimistic ones", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container, rerender } = mountList();

    act(() => {
      const atBottomChange = h.virtuosoProps.atBottomStateChange as (atBottom: boolean) => void;
      atBottomChange(false);
    });

    const own = makeMessage("mine");
    own.localStatus = "sending";
    h.storeState.messages = [makeMessage("a"), own, makeMessage("b")];
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("1");
  });

  it("stays quiet while at the bottom — the followOutput scroll is Virtuoso's job", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container, rerender } = mountList();

    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    rerender(<MessageList renderMessage={renderMessage} />);

    expect(container.querySelector(".scroll-to-bottom-btn")).toBeNull();
  });

  it("clears the pill when the user returns to the bottom", () => {
    h.storeState.messages = [makeMessage("a")];
    const { container, rerender } = mountList();

    const atBottomChange = h.virtuosoProps.atBottomStateChange as (atBottom: boolean) => void;
    act(() => atBottomChange(false));
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(container.querySelector(".scroll-to-bottom-badge")?.textContent).toBe("1");

    act(() => atBottomChange(true));
    expect(container.querySelector(".scroll-to-bottom-btn")).toBeNull();
  });
});

describe("MessageList keyboard resize", () => {
  it("re-pins the bottom when the visual viewport shrinks and the user is at the bottom", async () => {
    const vvListeners = new Map<string, () => void>();
    const vvStub = {
      addEventListener: vi.fn((type: string, cb: () => void) => vvListeners.set(type, cb)),
      removeEventListener: vi.fn((type: string) => vvListeners.delete(type)),
      height: 800,
      offsetTop: 0,
      scroll: 0,
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vvStub });

    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    mountList();
    h.scrollToIndexSpy.mockClear();

    await act(async () => {
      vvListeners.get("resize")?.();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(h.scrollToIndexSpy).toHaveBeenCalledWith({ index: 1, align: "end", behavior: "auto" });
  });

  it("does not touch the scroll position for a user reading history", async () => {
    const vvListeners = new Map<string, () => void>();
    const vvStub = {
      addEventListener: vi.fn((type: string, cb: () => void) => vvListeners.set(type, cb)),
      removeEventListener: vi.fn((type: string) => vvListeners.delete(type)),
      height: 800,
      offsetTop: 0,
      scroll: 0,
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vvStub });

    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    mountList();

    act(() => {
      const atBottomChange = h.virtuosoProps.atBottomStateChange as (atBottom: boolean) => void;
      atBottomChange(false);
    });
    h.scrollToIndexSpy.mockClear();

    await act(async () => {
      vvListeners.get("resize")?.();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(h.scrollToIndexSpy).not.toHaveBeenCalled();
  });
});
