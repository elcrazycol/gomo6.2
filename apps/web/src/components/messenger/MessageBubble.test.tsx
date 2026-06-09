import { render, screen } from "@testing-library/react";
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

describe("MessageBubble", () => {
  it("renders message text", () => {
    render(
      <MessageBubble
        message={createMessage()}
        isMine={false}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders sent time from sent_at", () => {
    render(
      <MessageBubble
        message={createMessage({ sent_at: "2025-06-01T14:30:00Z" })}
        isMine={false}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("shows pending dot for sending messages", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ localStatus: "sending" })}
        isMine={true}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    const dot = container.querySelector(".status-pending");
    expect(dot).toBeInTheDocument();
  });

  it("shows double check when delivered", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        isMine={true}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
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
        isMine={true}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
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
        isMine={false}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
        peerReadAt="2025-06-01T12:02:00Z"
      />,
    );
    expect(container.querySelector(".message-status")).not.toBeInTheDocument();
  });

  it("applies is-mine class to bubble-row when isMine is true", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        isMine={true}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    const row = container.querySelector(".bubble-row");
    expect(row?.className).toContain("is-mine");
  });

  it("applies is-consecutive class", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        isMine={true}
        isConsecutive={true}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    const row = container.querySelector(".bubble-row");
    expect(row?.className).toContain("is-consecutive");
  });

  it("renders deleted message UI", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ is_deleted: true, content: "" })}
        isMine={false}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    expect(container.querySelector(".deleted-bubble")).toBeInTheDocument();
    expect(screen.getByText("Сообщение удалено")).toBeInTheDocument();
  });

  it("renders edited label for edited messages", () => {
    render(
      <MessageBubble
        message={createMessage({ is_edited: true })}
        isMine={true}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText("изм.")).toBeInTheDocument();
  });

  it("renders pinned indicator when isPinned", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage()}
        isMine={false}
        isConsecutive={false}
        isPinned={true}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
      />,
    );
    expect(container.querySelector(".is-pinned")).toBeInTheDocument();
  });

  it("renders failed state with retry button", () => {
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={createMessage({ localStatus: "failed" })}
        isMine={true}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
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
        isMine={false}
        isConsecutive={false}
        isPinned={false}
        onEdit={noop}
        onDelete={noop}
        onTogglePin={noop}
        onRetry={noop}
        quotedMessage={quoted}
      />,
    );
    expect(container.querySelector(".quoted-message")).toBeInTheDocument();
  });
});
