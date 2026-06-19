import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageBubble } from "./MessageBubble";
import type { MessageView } from "./types";

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
    render(
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
    render(
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
    render(
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
    render(
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
});
