import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { MessageBubble } from "./MessageBubble";
import { rememberAttachmentAspectRatio, __resetAttachmentRatioCacheForTests } from "@/utils/attachmentRatioCache";
import type { MessageView } from "./types";

// Emoji messages resolve their images through the shared emoji data context;
// a bare Map keeps them on the neutral inline-placeholder path so the bubble
// layout can be asserted without a provider + network.
vi.mock("@/contexts/EmojiDataContext", () => ({
  useEmojiData: () => ({
    allEmojis: new Map(),
    failedEmojiIds: new Set(),
    resolveEmojis: async () => undefined,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  __resetAttachmentRatioCacheForTests();
});

function createMessage(overrides: Partial<MessageView> = {}): MessageView {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    sender_user_id: "user-1",
    parent_message_id: null,
    content: "Hello, world!",
    is_edited: false,
    is_deleted: false,
    edited_at: null,
    sent_at: "2025-06-01T12:00:00Z",
    client_id: "cmid-1",
    ...overrides,
  };
}

const noop = vi.fn();

const defaultProps = {
  isMine: false,
  isConsecutive: false,
  isPinned: false,
  onEdit: noop,
  onDelete: noop,
  onTogglePin: noop,
  onRetry: noop,
  onReply: noop,
  onCopy: noop,
};

describe("MessageBubble", () => {
  it("renders message text", () => {
    render(<MessageBubble message={createMessage()} {...defaultProps} />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders sent time from sent_at", () => {
    render(
      <MessageBubble
        message={createMessage({ sent_at: "2025-06-01T14:30:00Z" })}
        {...defaultProps}
      />,
    );
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("shows pending dot for sending messages", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ localStatus: "sending" })}
        {...defaultProps}
        isMine={true}
      />,
    );
    const dot = container.querySelector(".status-pending");
    expect(dot).toBeInTheDocument();
  });

  it("shows double check when delivered", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
        peerDeliveredAt="2025-06-01T12:01:00Z"
        peerReadAt={null}
      />,
    );
    const check = container.querySelector(".status-double-check");
    expect(check).toBeInTheDocument();
  });

  it("shows double check with is-read class when read", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
        peerDeliveredAt="2025-06-01T12:01:00Z"
        peerReadAt="2025-06-01T12:02:00Z"
      />,
    );
    const check = container.querySelector(".status-double-check");
    expect(check).toBeInTheDocument();
    expect(check?.className).toContain("is-read");
  });

  it("does not show status section for other user's messages", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        peerReadAt="2025-06-01T12:02:00Z"
      />,
    );
    expect(container.querySelector(".message-status")).not.toBeInTheDocument();
  });

  it("applies is-mine class to bubble-row when isMine is true", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
      />,
    );
    const row = container.querySelector(".bubble-row");
    expect(row?.className).toContain("is-mine");
  });

  it("applies is-consecutive class", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
        isConsecutive={true}
      />,
    );
    const row = container.querySelector(".bubble-row");
    expect(row?.className).toContain("is-consecutive");
  });

  it("renders deleted message UI", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ is_deleted: true, content: "" })}
        {...defaultProps}
      />,
    );
    expect(container.querySelector(".deleted-bubble")).toBeInTheDocument();
    expect(screen.getByText("Сообщение удалено")).toBeInTheDocument();
  });

  it("renders media messages with a separate caption section and source aspect ratio", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({
          content: "пример фото",
          attachments: [{
            id: "att-1",
            url: "user-1/messenger/photo.jpg",
            type: "image",
            name: "photo.jpg",
            size: 1200,
            mime: "image/jpeg",
            meta: JSON.stringify({ width: 1200, height: 900 }),
          }],
        })}
        {...defaultProps}
        isMine={true}
      />,
    );

    expect(container.querySelector(".message-bubble.is-media-bubble")).toBeInTheDocument();
    expect(container.querySelector(".message-bubble.is-media-bubble.has-caption")).toBeInTheDocument();
    expect(container.querySelector(".message-content-media")).toBeInTheDocument();
    const caption = container.querySelector(".message-media-caption");
    const media = container.querySelector(".message-bubble.is-media-bubble .msg-attachment-image");
    expect(caption).toHaveTextContent("пример фото");
    expect(caption?.className).not.toContain("overlay");
    expect(media).toHaveStyle("aspect-ratio: 1.3333333333333333");
    expect(caption?.previousElementSibling).toBe(container.querySelector(".msg-attachments"));
  });

  it("uses the remembered aspect ratio for legacy photos without metadata", () => {
    rememberAttachmentAspectRatio("user-1/messenger/legacy.jpg", 9 / 16);
    const { container } = render(
      <MessageBubble
        message={createMessage({
          content: "",
          attachments: [{
            url: "user-1/messenger/legacy.jpg",
            type: "image",
            name: "legacy.jpg",
            size: 1200,
            mime: "image/jpeg",
          }],
        })}
        {...defaultProps}
        isMine={true}
      />,
    );

    expect(container.querySelector(".message-bubble.is-media-bubble")).toBeInTheDocument();
    expect(container.querySelector(".message-bubble.is-media-bubble.has-caption")).not.toBeInTheDocument();
    expect(container.querySelector(".message-bubble.is-media-bubble .msg-attachment-image")).toHaveStyle("aspect-ratio: 0.5625");
  });

  it("keeps timestamp and status inline for a one-line reply", () => {
    const rangePrototype = Range.prototype as Range & { getClientRects?: () => DOMRectList };
    const originalGetClientRects = rangePrototype.getClientRects;
    const rect = { top: 10, width: 80, height: 14 } as DOMRect;
    const rectList = {
      0: rect,
      length: 1,
      item: (index: number) => index === 0 ? rect : null,
    } as unknown as DOMRectList;

    Object.defineProperty(rangePrototype, "getClientRects", {
      configurable: true,
      value: () => rectList,
    });

    try {
      const quoted = createMessage({ id: "quoted-1", content: "original" });
      const { container } = render(
        <MessageBubble
          message={createMessage({ content: "ответ" })}
          {...defaultProps}
          isMine={true}
          quotedMessage={quoted}
        />,
      );

      const bubble = container.querySelector(".message-bubble");
      expect(bubble).toHaveClass("is-compact");
      expect(container.querySelector(".message-meta")).toBeInTheDocument();
    } finally {
      if (originalGetClientRects) {
        Object.defineProperty(rangePrototype, "getClientRects", {
          configurable: true,
          value: originalGetClientRects,
        });
      } else {
        delete rangePrototype.getClientRects;
      }
    }
  });

  it("keeps the time/status pill clear of a single-line emoji message", () => {
    const rangePrototype = Range.prototype as Range & { getClientRects?: () => DOMRectList };
    const originalGetClientRects = rangePrototype.getClientRects;
    const rect = { top: 10, width: 80, height: 14 } as DOMRect;
    const rectList = {
      0: rect,
      length: 1,
      item: (index: number) => index === 0 ? rect : null,
    } as unknown as DOMRectList;

    Object.defineProperty(rangePrototype, "getClientRects", {
      configurable: true,
      value: () => rectList,
    });

    try {
      const { container } = render(
        <MessageBubble
          message={createMessage({ content: "[e:emoji1]" })}
          {...defaultProps}
          isMine={true}
        />,
      );

      const bubble = container.querySelector(".message-bubble");
      // Emoji-only messages render through the rich-text stack, not the plain
      // <p>; the compact measurement must apply to it too.
      expect(container.querySelector(".message-content-stack")).toBeInTheDocument();
      expect(bubble).toHaveClass("is-compact");
    } finally {
      if (originalGetClientRects) {
        Object.defineProperty(rangePrototype, "getClientRects", {
          configurable: true,
          value: originalGetClientRects,
        });
      } else {
        delete rangePrototype.getClientRects;
      }
    }
  });

  it("keeps bottom space for a multiline reply", () => {
    const rangePrototype = Range.prototype as Range & { getClientRects?: () => DOMRectList };
    const originalGetClientRects = rangePrototype.getClientRects;
    const firstRect = { top: 10, width: 80, height: 14 } as DOMRect;
    const secondRect = { top: 28, width: 70, height: 14 } as DOMRect;
    const rects = [firstRect, secondRect];
    const rectList = {
      0: firstRect,
      1: secondRect,
      length: rects.length,
      item: (index: number) => rects[index] ?? null,
    } as unknown as DOMRectList;

    Object.defineProperty(rangePrototype, "getClientRects", {
      configurable: true,
      value: () => rectList,
    });

    try {
      const quoted = createMessage({ id: "quoted-1", content: "original" });
      const { container } = render(
        <MessageBubble
          message={createMessage({ content: "длинный ответ" })}
          {...defaultProps}
          isMine={true}
          quotedMessage={quoted}
        />,
      );

      const bubble = container.querySelector(".message-bubble");
      expect(bubble).toHaveClass("is-multiline");
      expect(bubble).not.toHaveClass("is-compact");
      expect(container.querySelector(".message-meta")).toBeInTheDocument();
    } finally {
      if (originalGetClientRects) {
        Object.defineProperty(rangePrototype, "getClientRects", {
          configurable: true,
          value: originalGetClientRects,
        });
      } else {
        delete rangePrototype.getClientRects;
      }
    }
  });

  it("keeps quoted media in the regular bubble layout", () => {
    const quoted = createMessage({ id: "quoted-1", content: "original" });
    const { container } = render(
      <MessageBubble
        message={createMessage({
          content: "caption",
          attachments: [{
            url: "user-1/messenger/photo.jpg",
            type: "image",
            name: "photo.jpg",
            size: 1200,
            mime: "image/jpeg",
          }],
        })}
        {...defaultProps}
        quotedMessage={quoted}
      />,
    );

    expect(container.querySelector(".message-bubble.is-media-bubble")).not.toBeInTheDocument();
    expect(container.querySelector(".message-content-media")).not.toBeInTheDocument();
    expect(container.querySelector(".msg-attachments")).toBeInTheDocument();
  });

  it("renders edited label for edited messages", () => {
    render(
      <MessageBubble
        message={createMessage({ is_edited: true })}
        {...defaultProps}
        isMine={true}
      />,
    );
    expect(screen.getByText("изм.")).toBeInTheDocument();
  });

  it("renders pinned indicator when isPinned", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isPinned={true}
      />,
    );
    expect(container.querySelector(".is-pinned")).toBeInTheDocument();
  });

  it("renders failed state with retry button", () => {
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={createMessage({ localStatus: "failed" })}
        {...defaultProps}
        isMine={true}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Не отправлено")).toBeInTheDocument();
    expect(screen.getByText("Повторить")).toBeInTheDocument();
  });

  it("renders quoted message when provided", () => {
    const quoted: MessageView = {
      id: "msg-quoted",
      conversation_id: "conv-1",
      sender_user_id: "user-2",
      parent_message_id: null,
      content: "Original message text",
      is_edited: false,
      is_deleted: false,
      edited_at: null,
      sent_at: "2025-01-01T00:00:00Z",
      client_id: "cq",
    };

    const { container } = render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        quotedMessage={quoted}
      />,
    );
    expect(container.querySelector(".quoted-message")).toBeInTheDocument();
  });

  it("opens context menu on right-click and calls onReply", async () => {
    const onReply = vi.fn();
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        onReply={onReply}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    const replyItem = await screen.findByText("Ответить");
    fireEvent.click(replyItem);
    expect(onReply).toHaveBeenCalled();
  });

  it("calls onCopy with message content", async () => {
    const onCopy = vi.fn();
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        onCopy={onCopy}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    const copyItem = await screen.findByText("Копировать");
    fireEvent.click(copyItem);
    expect(onCopy).toHaveBeenCalledWith("Hello, world!");
  });

  it("shows Edit and Delete only for own messages in context menu", async () => {
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByText("Редактировать");
    expect(screen.getByText("Удалить")).toBeInTheDocument();
  });

  it("hides Edit and Delete for other user's messages", async () => {
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={false}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByText("Ответить");
    expect(screen.queryByText("Редактировать")).not.toBeInTheDocument();
    expect(screen.queryByText("Удалить")).not.toBeInTheDocument();
  });

  // A chat-panel harness so the scrim/host classes and dismissal wiring can be
  // asserted the way they live in the real chat.
  function renderInChat(ui: ReactElement) {
    return render(
      <div className="chat-panel">
        <div className="message-scroll">
          <div className="message-virtual-list">
            <div className="message-virtual-item">{ui}</div>
          </div>
        </div>
      </div>,
    );
  }

  it("anchors the action panel under the message and blurs the rest of the chat", async () => {
    const { container } = renderInChat(
      <MessageBubble message={createMessage()} {...defaultProps} />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    const panel = await screen.findByRole("menu");
    expect(panel.className).toContain("msg-action-panel");

    // The panel floats in the lifted overlay, next to a pixel-identical copy
    // of the message; the in-list bubble is hidden in place (layout kept).
    const lift = panel.parentElement;
    expect(lift?.className).toContain("msg-action-lift");
    expect(lift?.querySelector(".message-bubble")).not.toBeNull();
    const inListBubble = container.querySelector(".bubble-row .message-bubble");
    expect(inListBubble?.className).toContain("is-menu-hidden");

    // The chat blurs (per-surface), and only this message's row is excluded.
    expect(container.querySelector(".chat-panel")?.className).toContain("has-message-menu");
    const host = container.querySelector(".message-virtual-item");
    expect(host?.className).toContain("is-menu-host");
  });

  it("dismisses the panel on outside tap but keeps it open when tapping inside", async () => {
    const { container } = renderInChat(
      <MessageBubble message={createMessage()} {...defaultProps} />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByRole("menu");

    const replyItem = screen.getByText("Ответить");
    fireEvent.pointerDown(replyItem);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    const scroller = container.querySelector(".message-scroll");
    expect(scroller).not.toBeNull();
    fireEvent.pointerDown(scroller as Element);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(container.querySelector(".chat-panel")?.className).not.toContain("has-message-menu");
  });

  it("dismisses the panel on Escape and drops the scrim classes", async () => {
    const { container } = renderInChat(
      <MessageBubble message={createMessage()} {...defaultProps} />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByRole("menu");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(container.querySelector(".chat-panel")?.className).not.toContain("has-message-menu");
    expect(container.querySelector(".message-virtual-item")?.className).not.toContain("is-menu-host");
  });

  it("floats exactly ONE copy of the message even under StrictMode double effects", async () => {
    const { container } = renderInChat(
      <StrictMode>
        <MessageBubble message={createMessage()} {...defaultProps} />
      </StrictMode>,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByRole("menu");
    // The overlay's layout effect deep-clones the bubble; React StrictMode
    // runs effects twice, and the idempotent append must not stack copies.
    expect(container.querySelectorAll(".msg-action-lift .message-bubble").length).toBe(1);
  });
});
