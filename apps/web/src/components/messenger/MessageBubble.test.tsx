import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MessageBubble } from "./MessageBubble";import type { MessageView } from "./types";

function createMessage(overrides: Partial<MessageView> = {}): MessageView {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    sender_user_id: "user-1",
    client_message_id: "cmid-1",
    sent_at: "2025-06-01T12:00:00Z",
    content_encrypted: "",
    content: "Hello, world!",
    plainText: "Hello, world!",
    peerDeliveredAt: null,
    peerReadAt: null,
    ...overrides,
  };
}

describe("MessageBubble", () => {
  it("renders message text", () => {
    render(<MessageBubble message={createMessage()} isMine={false} />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders sent time from sent_at", () => {
    render(<MessageBubble message={createMessage({ sent_at: "2025-06-01T14:30:00Z" })} isMine={false} />);
    // Intl.DateTimeFormat with ru-RU should render hour:minute
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("renders time as HH:MM format", () => {
    render(<MessageBubble message={createMessage({ sent_at: "2025-06-01T12:00:00Z" })} isMine={false} />);
    // Match any two-digit time pattern (HH:MM), since timezone may vary
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("shows pending dot for pending messages", () => {
    const { container } = render(<MessageBubble message={createMessage({ localStatus: "pending" })} isMine={true} />);
    const dot = container.querySelector(".status-pending");
    expect(dot).toBeInTheDocument();
  });

  it("shows double check (✓✓) when delivered", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ peerDeliveredAt: "2025-06-01T12:01:00Z", peerReadAt: null })}
        isMine={true}
      />,
    );
    const check = container.querySelector(".status-double-check");
    expect(check).toBeInTheDocument();
  });

  it("shows double check with is-read class when read", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ peerDeliveredAt: "2025-06-01T12:01:00Z", peerReadAt: "2025-06-01T12:02:00Z" })}
        isMine={true}
      />,
    );
    const check = container.querySelector(".status-double-check");
    expect(check).toBeInTheDocument();
    expect(check?.className).toContain("is-read");
  });

  it("does not show status section for other user's messages", () => {
    const { container } = render(<MessageBubble message={createMessage({ peerReadAt: "2025-06-01T12:02:00Z" })} isMine={false} />);
    const bubble = container.querySelector(".message-bubble");
    expect(bubble?.className).not.toContain("is-read");
    expect(container.querySelector(".message-status")).not.toBeInTheDocument();
  });

  it("applies is-mine class to bubble-row when isMine is true", () => {
    const { container } = render(<MessageBubble message={createMessage()} isMine={true} />);
    const row = container.querySelector(".bubble-row");
    expect(row?.className).toContain("is-mine");
  });

  it("applies is-mine class to message-bubble when isMine is true", () => {
    const { container } = render(<MessageBubble message={createMessage()} isMine={true} />);
    const bubble = container.querySelector(".message-bubble");
    expect(bubble?.className).toContain("is-mine");
  });

  it("does not apply is-mine class when isMine is false", () => {
    const { container } = render(<MessageBubble message={createMessage()} isMine={false} />);
    const row = container.querySelector(".bubble-row");
    expect(row?.className).not.toContain("is-mine");
  });
});
