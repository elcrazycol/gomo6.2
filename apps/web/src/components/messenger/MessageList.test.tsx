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
    const data = props.data as unknown[] | undefined;
    const itemContent = props.itemContent as ((index: number, item?: unknown) => React.ReactNode) | undefined;
    const computeItemKey = props.computeItemKey as ((index: number, item?: unknown) => unknown) | undefined;
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
    const count = (props.totalCount as number | undefined) ?? data?.length ?? 0;
    const items = Array.from({ length: count }, (_, index) => {
      const item = data?.[index];
      return <div key={(computeItemKey?.(index, item) ?? index) as React.Key}>{itemContent?.(index, item)}</div>;
    });
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
    const computeItemKey = h.virtuosoProps.computeItemKey as (index: number, item?: MessageView) => unknown;
    expect(computeItemKey(initialIndex, makeMessage("a"))).toBe("a");
  });

  it("shows the history loader while older messages are being fetched", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    h.storeState.isLoadingMore = true;
    const { container } = mountList();
    expect(container.querySelector(".msg-history-header")?.classList.contains("is-loading")).toBe(true);
    expect(container.querySelector(".msg-history-loader")).not.toBeNull();
  });

  it("keeps the header at a constant height when idle (spacer, not a popped-out loader)", () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.hasMoreMessages = true;
    const { container } = mountList();
    // The header stays mounted so appearing/disappearing loading states never
    // shift the items below it.
    expect(container.querySelector(".msg-history-header")).not.toBeNull();
    expect(container.querySelector(".msg-history-loader")).toBeNull();
    expect(container.querySelector(".msg-history-spacer")).not.toBeNull();
  });

  it("shows the end-of-history marker when there is nothing older to load", () => {
    h.storeState.messages = [makeMessage("a")];
    h.storeState.hasMoreMessages = false;
    const { container } = mountList();
    const header = container.querySelector(".msg-history-header");
    expect(header?.classList.contains("is-end")).toBe(true);
    expect(header?.textContent).toContain("Начало переписки");
  });

  it("renders the bottom gap footer element", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { container } = mountList();
    expect(container.querySelector(".message-list-footer")).not.toBeNull();
  });

  it("disables followOutput — the append effect owns the deterministic follow", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    mountList();
    // followOutput is off: its target comes from unmeasured heights and lands
    // short; the append effect snaps to the exact bottom instead.
    expect(h.virtuosoProps.followOutput).toBe(false);
  });

  it("opens at the newest message of the first batch (captured once, not on every append)", () => {
    h.storeState.messages = [makeMessage("a"), makeMessage("b")];
    const { rerender } = mountList();
    expect(h.virtuosoProps.alignToBottom).toBe(true);
    // First non-empty batch: index of the last message.
    expect(h.virtuosoProps.initialTopMostItemIndex).toBe(1);

    // Appends must NOT move the captured initial index (a changing value makes
    // Virtuoso re-scroll on every data change).
    h.storeState.messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    rerender(<MessageList renderMessage={renderMessage} />);
    expect(h.virtuosoProps.initialTopMostItemIndex).toBe(1);
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


