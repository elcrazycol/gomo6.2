import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { MessageBubble } from "./MessageBubble";
import { rememberAttachmentAspectRatio, __resetAttachmentRatioCacheForTests } from "@/utils/attachmentRatioCache";
import type { MessageView } from "./types";

// Emoji messages resolve their images through the shared emoji data context;
// a bare Map keeps them on the neutral inline-placeholder path so the bubble
// layout can be asserted without a provider + network.
const { mockHaptics } = vi.hoisted(() => ({
  mockHaptics: { tick: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/haptics", () => ({
  hapticTick: mockHaptics.tick,
  hapticSuccess: mockHaptics.success,
}));

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
  mockHaptics.tick.mockClear();
  mockHaptics.success.mockClear();
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

describe("MessageBubble — touch double-tap", () => {
  const rowOf = () => screen.getByText("Hello, world!").closest(".bubble-row")!;
  const touchAt = (x: number, y: number) => {
    fireEvent.pointerUp(rowOf(), { pointerType: "touch", clientX: x, clientY: y });
  };
  const onToggleReaction = vi.fn();
  beforeEach(() => onToggleReaction.mockClear());

  it("applies the quick reaction on a double tap, with the confirmation cue", () => {
    const onReply = vi.fn();
    render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        onReply={onReply}
        onToggleReaction={onToggleReaction}
      />,
    );

    touchAt(100, 100);
    touchAt(102, 103);

    // Telegram's model: the double-tap is the reaction, the swipe is the reply.
    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "❤️");
    expect(onReply).not.toHaveBeenCalled();
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
    // …and the emoji floats over the bubble as the feedback.
    expect(rowOf().querySelector(".reaction-float")?.textContent).toBe("❤️");
  });

  it("uses the reader's last reaction as the quick one", () => {
    localStorage.setItem("gomo6:reactions:recent", "🔥");
    render(<MessageBubble message={createMessage()} {...defaultProps} onToggleReaction={onToggleReaction} />);

    touchAt(100, 100);
    touchAt(100, 100);

    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "🔥");
  });

  it("does nothing on a double tap without a reaction handler", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={createMessage()} {...defaultProps} onReply={onReply} />);

    touchAt(100, 100);
    touchAt(100, 100);

    expect(onToggleReaction).not.toHaveBeenCalled();
    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not react when the two taps are too far apart in time", () => {
    // A controllable clock: `Date.now` is read by plenty of other code during a
    // render, so a once-per-call mock would be consumed by them.
    let clock = 1_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    render(<MessageBubble message={createMessage()} {...defaultProps} onToggleReaction={onToggleReaction} />);

    touchAt(100, 100);
    clock = 1_500;
    touchAt(100, 100);

    expect(onToggleReaction).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("does not react when the second tap is a drag", () => {
    render(<MessageBubble message={createMessage()} {...defaultProps} onToggleReaction={onToggleReaction} />);

    touchAt(100, 100);
    touchAt(160, 100);

    expect(onToggleReaction).not.toHaveBeenCalled();
  });

  it("leaves the mouse to the native double-click (reply)", () => {
    const onReply = vi.fn();
    render(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        onReply={onReply}
        onToggleReaction={onToggleReaction}
      />,
    );

    fireEvent.pointerUp(rowOf(), { pointerType: "mouse", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(rowOf(), { pointerType: "mouse", clientX: 100, clientY: 100 });

    expect(onToggleReaction).not.toHaveBeenCalled();
    expect(onReply).not.toHaveBeenCalled();
  });
});

describe("MessageBubble — voice messages", () => {
  const voice: MessageView["attachments"] = [{
    url: "u1/messenger/voice.webm",
    type: "audio",
    name: "voice.webm",
    size: 2048,
    mime: "audio/webm",
    meta: JSON.stringify({ voice: true, duration: 7, waveform: new Array(40).fill(50) }),
  }];

  it("renders the voice player instead of a browser audio bar", () => {
    const { container } = render(
      <MessageBubble message={createMessage({ attachments: voice })} {...defaultProps} />,
    );

    expect(container.querySelector(".voice-player")).not.toBeNull();
    expect(container.querySelector("audio[controls]")).toBeNull();
    // Its own bubble shape: the meta must not try to sit inline over the player.
    expect(container.querySelector(".message-bubble")?.className).toContain("is-voice-bubble");
  });

  it("renders the unheard dot when the chat view says the note is unheard", () => {
    const { container, rerender } = render(
      <MessageBubble message={createMessage({ attachments: voice })} {...defaultProps} isMine={false} voiceUnheard />,
    );
    expect(container.querySelector(".message-unheard-dot")).not.toBeNull();

    rerender(<MessageBubble message={createMessage({ attachments: voice })} {...defaultProps} isMine={false} voiceUnheard={false} />);
    expect(container.querySelector(".message-unheard-dot")).toBeNull();
  });

  it("keeps an ordinary audio file a file row", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ attachments: [{ ...voice![0], name: "song.mp3", meta: null }] })}
        {...defaultProps}
      />,
    );

    expect(container.querySelector(".voice-player")).toBeNull();
    expect(container.querySelector(".msg-attachment-file")).not.toBeNull();
  });
});

describe("MessageBubble — reactions", () => {
  const reaction = {
    emoji: "🔥",
    count: 2,
    mine: false,
    users: [{ id: "u2", username: "bob" }, { id: "u3", username: "carol" }],
  };

  it("renders the chips under the bubble and toggles on tap", () => {
    const onToggleReaction = vi.fn();
    const { container } = render(
      <MessageBubble
        message={createMessage({ reactions: [reaction] })}
        {...defaultProps}
        viewerId="u1"
        onToggleReaction={onToggleReaction}
      />,
    );

    const chip = container.querySelector(".msg-reaction-chip") as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe("🔥2");

    fireEvent.click(chip);
    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "🔥");
    expect(mockHaptics.tick).toHaveBeenCalledTimes(1);
  });

  it("offers the quick bar in the action panel and applies the pick", async () => {
    const onToggleReaction = vi.fn();
    const { container } = render(
      <div className="chat-panel">
        <div className="message-scroll">
          <div className="message-list">
            <div className="message-row">
              <MessageBubble
                message={createMessage()}
                {...defaultProps}
                viewerId="u1"
                onToggleReaction={onToggleReaction}
              />
            </div>
          </div>
        </div>
      </div>,
    );

    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByRole("menu");

    const bar = container.querySelector(".msg-reaction-bar");
    expect(bar).not.toBeNull();

    // A press on the bar must not reach the panel's outside-tap dismissal — it
    // is real UI in the same floated group, not part of the scrim.
    const pick = screen.getByRole("button", { name: "🔥" });
    fireEvent.pointerDown(pick);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(pick);

    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "🔥");
    // The bar closes with the panel: the chip under the message is the answer.
    await vi.waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("keeps reactions out of a surface without a handler", () => {
    const { container } = render(
      <MessageBubble message={createMessage({ reactions: [reaction] })} {...defaultProps} />,
    );

    expect(container.querySelector(".msg-reactions")).toBeNull();
  });
});

describe("MessageBubble", () => {
  it("jumps to the quoted message when the quote is tapped", () => {
    const onJumpToMessage = vi.fn();
    const quoted = createMessage({ id: "quoted-1", content: "оригинал" });

    render(
      <MessageBubble
        message={createMessage({ parent_message_id: "quoted-1" })}
        {...defaultProps}
        quotedMessage={quoted}
        onJumpToMessage={onJumpToMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Перейти к сообщению" }));
    expect(onJumpToMessage).toHaveBeenCalledWith("quoted-1");
  });

  it("renders the quote as plain text when the bubble cannot jump", () => {
    const quoted = createMessage({ id: "quoted-1", content: "оригинал" });

    render(
      <MessageBubble
        message={createMessage({ parent_message_id: "quoted-1" })}
        {...defaultProps}
        quotedMessage={quoted}
      />,
    );

    expect(screen.queryByRole("button", { name: "Перейти к сообщению" })).toBeNull();
    expect(screen.getByText("оригинал")).toBeInTheDocument();
  });

  it("renders message text", () => {
    render(<MessageBubble message={createMessage()} {...defaultProps} />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders sent time from sent_at", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ sent_at: "2025-06-01T14:30:00Z" })}
        {...defaultProps}
      />,
    );
    // The pill is rendered twice (visible + invisible inline twin), so query
    // the visible one explicitly instead of by text alone.
    expect(container.querySelector(".message-meta")?.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("shows the outbox clock while a message is sending", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ localStatus: "sending" })}
        {...defaultProps}
        isMine={true}
      />,
    );
    // Telegram's clock, not a dot: the outbox still owns the message.
    expect(container.querySelector(".status-clock")).toBeInTheDocument();
    expect(container.querySelector(".status-pending")).toBeNull();
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

  it("renders nothing for a deleted message (no «Сообщение удалено» plate)", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ is_deleted: true, content: "" })}
        {...defaultProps}
      />,
    );
    expect(container.querySelector(".bubble-row")).not.toBeInTheDocument();
    expect(container.querySelector(".deleted-bubble")).not.toBeInTheDocument();
    expect(screen.queryByText("Сообщение удалено")).not.toBeInTheDocument();
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

  it("renders a photo with no text at all as a media bubble (never a zero-size row)", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({
          content: "",
          attachments: [{
            id: "att-1",
            url: "user-1/messenger/photo.jpg",
            type: "image",
            name: "photo.jpg",
            size: 1200,
            mime: "image/jpeg",
            meta: JSON.stringify({ width: 1200, height: 800 }),
          }],
        })}
        {...defaultProps}
        isMine={true}
      />,
    );

    expect(container.querySelector(".message-bubble.is-media-bubble")).toBeInTheDocument();
    expect(container.querySelector(".message-bubble.is-media-bubble.has-caption")).not.toBeInTheDocument();
    const media = container.querySelector(".msg-attachment-image") as HTMLElement;
    expect(media).toBeInTheDocument();
    // Pixel width + max-width: the box can hug the photo without collapsing.
    expect(media.style.width).toBe("640px");
    expect(media.style.maxWidth).toBe("100%");
  });

  it("marks multi-photo messages as albums and keeps photo+link captions inside the media bubble", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({
          content: "смотри https://gomo6.local",
          attachments: [
            { id: "a1", url: "u/1.jpg", type: "image", name: "1.jpg", size: 1, mime: "image/jpeg" },
            { id: "a2", url: "u/2.jpg", type: "image", name: "2.jpg", size: 1, mime: "image/jpeg" },
          ],
        })}
        {...defaultProps}
        isMine={true}
      />,
    );

    expect(container.querySelector(".message-bubble.is-media-bubble.is-media-album")).toBeInTheDocument();
    expect(container.querySelector(".message-media-caption")).toHaveTextContent("смотри");
    expect(container.querySelector(".msg-media-mosaic")).toBeInTheDocument();
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

  it("places the timestamp without reading layout back from the DOM", () => {
    // The old implementation forced a synchronous reflow per bubble
    // (offsetWidth + Range.getClientRects + ResizeObserver). Any regression
    // would immediately show up here as a call.
    const rangeSpy = vi.spyOn(document, "createRange");
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const offsetWidthSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: offsetWidthSpy,
    });

    try {
      const { container } = render(
        <MessageBubble message={createMessage({ content: "ответ" })} {...defaultProps} isMine={true} />,
      );

      expect(rangeSpy).not.toHaveBeenCalled();
      expect(offsetWidthSpy).not.toHaveBeenCalled();
      expect(container.querySelector(".message-meta")).toBeInTheDocument();
    } finally {
      rangeSpy.mockRestore();
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidthDescriptor);
      }
    }
  });

  it("reserves the pill's exact width with an invisible inline twin", () => {
    const { container } = render(
      <MessageBubble
        message={createMessage({ content: "ответ", is_edited: true })}
        {...defaultProps}
        isMine={true}
      />,
    );

    const reserve = container.querySelector(".message-content-text .message-meta-reserve");
    const meta = container.querySelector(".message-meta");
    expect(reserve).toBeInTheDocument();
    expect(meta).toBeInTheDocument();
    // Same children → same width in the line box. It must be *invisible*, not
    // removed: visibility:hidden still participates in layout.
    expect(reserve?.textContent).toBe(meta?.textContent);
    expect(reserve).toHaveAttribute("aria-hidden", "true");
    expect(reserve?.textContent).toContain("изм.");
  });

  it("puts the inline twin inside the rich-text stack for emoji messages", () => {
    const { container } = render(
      <MessageBubble message={createMessage({ content: "[e:emoji1]" })} {...defaultProps} isMine={true} />,
    );

    expect(container.querySelector(".message-content-stack .message-meta-reserve")).toBeInTheDocument();
  });

  it("does not reserve inline space for media or failed bubbles", () => {
    const cases: MessageView[] = [
      createMessage({
        content: "",
        attachments: [{ url: "user-1/messenger/photo.jpg", type: "image", name: "photo.jpg", size: 10, mime: "image/jpeg" }],
      }),
      createMessage({ localStatus: "failed" }),
    ];

    for (const message of cases) {
      const { container, unmount } = render(<MessageBubble message={message} {...defaultProps} isMine={true} />);
      expect(container.querySelector(".message-meta-reserve")).not.toBeInTheDocument();
      expect(container.querySelector(".message-meta")).toBeInTheDocument();
      unmount();
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
    const { container } = render(
      <MessageBubble
        message={createMessage({ is_edited: true })}
        {...defaultProps}
        isMine={true}
      />,
    );
    expect(container.querySelector(".message-meta")?.textContent).toContain("изм.");
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

  it("marks a failed send with a small ! that opens retry / delete", () => {
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <MessageBubble
        message={createMessage({ localStatus: "failed" })}
        {...defaultProps}
        isMine={true}
        onRetry={onRetry}
        onDelete={onDelete}
      />,
    );

    // No in-bubble error header: the failure is one quiet badge.
    expect(container.querySelector(".message-error-header")).not.toBeInTheDocument();
    const dot = screen.getByRole("button", { name: "Сообщение не отправлено" });
    expect(dot).toHaveTextContent("!");

    fireEvent.click(dot);
    fireEvent.click(screen.getByRole("menuitem", { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ localStatus: "failed" }));

    fireEvent.click(dot);
    fireEvent.click(screen.getByRole("menuitem", { name: /Удалить/ }));
    expect(onDelete).toHaveBeenCalledWith("msg-1");
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

  it("asks before deleting: the panel opens a compact confirmation", async () => {
    const onDelete = vi.fn();
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
        onDelete={onDelete}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    fireEvent.click(await screen.findByText("Удалить"));

    expect(await screen.findByText("Удалить сообщение?")).toBeInTheDocument();
    expect(screen.getByText(/исчезнет у вас и у собеседника/i)).toBeInTheDocument();
    // Nothing is deleted until the reader confirms.
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation keeps the message", async () => {
    const onDelete = vi.fn();
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
        onDelete={onDelete}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    fireEvent.click(await screen.findByText("Удалить"));
    fireEvent.click(await screen.findByRole("button", { name: "Отмена" }));

    await waitFor(() => expect(screen.queryByText("Удалить сообщение?")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirming deletes the message", async () => {
    const onDelete = vi.fn();
    renderInChat(
      <MessageBubble
        message={createMessage()}
        {...defaultProps}
        isMine={true}
        onDelete={onDelete}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    fireEvent.click(await screen.findByText("Удалить"));
    // The panel's item is a menuitem; the dialog's action is the only button
    // named «Удалить» at this point.
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));

    expect(onDelete).toHaveBeenCalledWith("msg-1");
  });

  // A chat-panel harness so the scrim/host classes and dismissal wiring can be
  // asserted the way they live in the real chat.
  function renderInChat(ui: ReactElement) {
    return render(
      <div className="chat-panel">
        <div className="message-scroll">
          <div className="message-list">
            <div className="message-row">{ui}</div>
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
    const host = container.querySelector(".message-row");
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
    expect(container.querySelector(".message-row")?.className).not.toContain("is-menu-host");
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

  it("keeps composer focus when the panel is dismissed by an outside tap", async () => {
    const { container } = renderInChat(
      <>
        <MessageBubble message={createMessage()} {...defaultProps} />
        <div className="composer"><input aria-label="editor" /></div>
      </>,
    );
    const input = container.querySelector(".composer input") as HTMLInputElement;
    input.focus();

    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByRole("menu");

    const scroller = container.querySelector(".message-scroll") as Element;
    const evt = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => { scroller.dispatchEvent(evt); });
    // The outside tap is swallowed so it cannot blur the composer input…
    expect(evt.defaultPrevented).toBe(true);
    // …and the panel still dismisses.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not swallow outside taps when the composer had no focus", async () => {
    const { container } = renderInChat(
      <MessageBubble message={createMessage()} {...defaultProps} />,
    );
    fireEvent.contextMenu(screen.getByText("Hello, world!"));
    await screen.findByRole("menu");

    const scroller = container.querySelector(".message-scroll") as Element;
    const evt = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => { scroller.dispatchEvent(evt); });
    expect(evt.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
