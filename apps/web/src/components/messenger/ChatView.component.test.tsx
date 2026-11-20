import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatView } from "./ChatView";
import { __resetDraftsForTests, readDraft } from "./core/drafts";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockReadThrough, mockListProps } = vi.hoisted(() => ({
  mockReadThrough: { value: null as string | null },
  mockListProps: {} as any,
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const { mockStore } = vi.hoisted(() => {
  return {
    mockStore: {
      conversations: [] as any[],
      openingUnreadCount: 0,
      selectedConversationId: null,
      messages: [] as any[],
      isMessagesLoading: false,
      isSending: false,
      me: null,
      receipts: new Map(),
      error: null,
      setError: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue("msg-1"),
      editMessage: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      togglePin: vi.fn().mockResolvedValue(undefined),
      toggleNotesPin: vi.fn().mockResolvedValue(undefined),
      setConversationBlockedByMe: vi.fn(),
      loadConversations: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock("@/stores/messengerStore", () => ({
    getConversationReadThrough: () => mockReadThrough.value,
  useMessengerStore: (selector: any) => selector(mockStore),
  selectSelectedConversation: (s: any) =>
    s.conversations.find((c: any) => c.id === s.selectedConversationId) ?? null,
  queueMarkDelivered: vi.fn(),
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: ({ size }: { size: string }) => (
    <span data-testid={`loader-${size}`}>Loading...</span>
  ),
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username, displayName }: any) => (
    <span data-testid="user-badge">{displayName || username}</span>
  ),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, key?: string | null) => key || null,
}));

const mockConnection = vi.hoisted(() => ({ status: "connected" as "connected" | "connecting" | "offline" }));

const { mockUnblockUser } = vi.hoisted(() => ({ mockUnblockUser: vi.fn().mockResolvedValue({ blocked: false }) }));

vi.mock("@/services/messengerApi", () => ({
  messengerApi: { unblockUser: mockUnblockUser },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/useMessengerConnection", () => ({
  useMessengerConnection: () => mockConnection.status,
}));

vi.mock("@/hooks/useFileDrop", () => ({
  useFileDrop: () => ({ isDragging: false, dragHandlers: {} }),
}));

vi.mock("@/utils/notesCrypto", () => ({
  hasNotesKey: () => false,
}));

vi.mock("./utils", () => ({
  formatPresence: (online: boolean | null, lastSeen: string | null) =>
    online ? "в сети" : lastSeen ? "был(а) недавно" : "не в сети",
  formatTime: () => "12:00",
  getInitials: (name: string) => name.slice(0, 2).toUpperCase(),
  getGroupInitials: (name: string | null) => (name || "GR").slice(0, 2).toUpperCase(),
  getUserColorClass: () => "color-user",
}));

vi.mock("./MessageContent", () => ({
  parseGiftContent: () => null,
  GiftDetailDialog: () => <div data-testid="gift-detail">Gift detail</div>,
}));

vi.mock("./NotesSettingsDialog", () => ({
  NotesSettingsDialog: () => <div data-testid="notes-settings" />,
}));

vi.mock("./NotesOrganizeDialog", () => ({
  NotesOrganizeDialog: () => <div data-testid="notes-organize" />,
}));

vi.mock("./UserInfoPanel", () => ({
  UserInfoPanel: ({ open, onClose }: any) =>
    open ? (
      <div data-testid="user-info-panel">
        <button onClick={onClose}>close-panel</button>
      </div>
    ) : null,
}));

vi.mock("./MessageList", () => ({
  MessageList: (props: any) => {
    Object.assign(mockListProps, props);
    const { messagesOverride, renderMessage } = props;
    return (
    <div data-testid="message-list">
      {messagesOverride.map((msg: any, index: number) => (
        <div key={msg.id} data-testid="message-item">
          {renderMessage(
            msg,
            index > 0 ? messagesOverride[index - 1] : null,
            { dateLabel: null, isConsecutive: false }
          )}
        </div>
      ))}
    </div>
    );
  },
}));

// Composer mock exposes internal props for driving send/edit flows
const { mockComposerProps, mockComposerState } = vi.hoisted(() => ({
  mockComposerProps: {} as any,
  mockComposerState: { mounts: 0, drafts: [] as string[] },
}));

vi.mock("./MessageComposer", () => ({
  MessageComposer: (props: any) => {
    Object.assign(mockComposerProps, props);
    mockComposerState.mounts += 1;
    mockComposerState.drafts.push(props.draft);
    return (
      <div data-testid="composer">
        <span data-testid="composer-draft">{props.draft}</span>
        <button onClick={() => props.onSend()}>send</button>
        <button onClick={() => props.setDraft("hello")}>set-draft</button>
        <button onClick={() => props.onSaveEdit("m1", "edited")}>save-edit</button>
        <button onClick={() => props.onCancelEdit()}>cancel-edit</button>
      </div>
    );
  },
}));

// MessageBubble mock exposes callbacks
vi.mock("./MessageBubble", () => ({
  MessageBubble: ({ message, onReply, onEdit, onDelete }: any) => (
    <div data-testid="message-bubble">
      <span>{message.content}</span>
      <button onClick={() => onReply(message)}>reply</button>
      <button onClick={() => onEdit(message.id, message.content)}>edit</button>
      <button onClick={() => onDelete(message.id)}>delete</button>
    </div>
  ),
}));

vi.mock("./attachmentAlbum", () => ({
  chunkAttachments: (attachments: any[]) => [attachments],
  MAX_ALBUM_ATTACHMENTS: 6,
}));

vi.mock("./attachmentUpload", () => ({
  uploadFilesAsAttachments: vi.fn().mockResolvedValue([]),
}));

function mockConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    last_message_at: "2025-06-01T12:00:00Z",
    last_message_preview: "Hello",
    unread_count: 0,
    other_user_id: "other-1",
    other_username: "alice",
    other_avatar_url: null,
    other_display_name: null,
    other_nickname_emoji_id: null,
    other_is_online: true,
    other_last_seen_at: null,
    is_notes: false,
    is_group: false,
    member_count: 1,
    pinned_message_id: null,
    ...overrides,
  };
}

function mockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    conversation_id: "conv-1",
    sender_user_id: "other-1",
    sender_username: "alice",
    content: "Привет",
    sent_at: "2025-06-01T12:00:00Z",
    is_edited: false,
    is_deleted: false,
    client_id: "c1",
    ...overrides,
  };
}

const defaultProps = {
  onBack: vi.fn(),
  composerRef: { current: null } as React.RefObject<{ focus: () => void; insertText: (text: string) => void; clear: () => void; insertEmoji: (data: unknown, opts?: { focus?: boolean }) => void; getEditor: () => null } | null>,
  typingUsername: null as string | null,
  onTyping: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.conversations = [];
  mockStore.selectedConversationId = null;
  mockStore.messages = [];
  mockStore.isMessagesLoading = false;
  mockStore.me = null;
  mockStore.error = null;
  mockStore.receipts = new Map();
  Object.keys(mockComposerProps).forEach((k) => delete mockComposerProps[k]);
  mockComposerState.mounts = 0;
  mockComposerState.drafts = [];
  mockReadThrough.value = null;
  Object.keys(mockListProps).forEach((k) => delete mockListProps[k]);
  __resetDraftsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChatView", () => {
  describe("unread marker", () => {
    beforeEach(() => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation()];
      mockStore.selectedConversationId = "conv-1";
      // The list only renders when there is something to render.
      mockStore.messages = [mockMessage()];
    });

    it("passes the read line as the boundary only when the chat had unread", () => {
      mockReadThrough.value = "2025-06-01T11:00:00Z";
      mockStore.openingUnreadCount = 3;

      render(<ChatView {...defaultProps} />);

      expect(mockListProps.unreadBoundaryAt).toBe("2025-06-01T11:00:00Z");
    });

    it("passes no boundary at all for a chat that had nothing unread", () => {
      // The server has no read line for this chat (or it is stale), but the chat
      // is not unread: a marker at its top would be a lie. `undefined` is "the
      // caller says nothing" — `null` would mean "nothing is known to be read",
      // which is exactly what puts a marker at the top.
      mockReadThrough.value = null;
      mockStore.openingUnreadCount = 0;

      render(<ChatView {...defaultProps} />);

      expect(mockListProps.unreadBoundaryAt).toBeUndefined();
    });

    it("passes null (marker at the top) for an unread chat with no known read line", () => {
      mockReadThrough.value = null;
      mockStore.openingUnreadCount = 4;

      render(<ChatView {...defaultProps} />);

      expect(mockListProps.unreadBoundaryAt).toBeNull();
    });
  });

  describe("profile navigation from the chat avatar", () => {
    beforeEach(() => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation({ other_avatar_url: "/avatar.jpg" })];
      mockStore.selectedConversationId = "conv-1";
      mockStore.messages = [mockMessage()];
    });

    it("carries the tapped avatar's viewport box into the profile route", () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        x: 14, y: 24, width: 40, height: 40,
      } as DOMRect);

      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Открыть профиль" }));

      expect(mockNavigate).toHaveBeenCalledWith("/profile/other-1", {
        state: {
          originAvatarRect: { x: 14, y: 24, width: 40, height: 40 },
          originAvatarSrc: "/avatar.jpg",
        },
      });
    });

    it("still opens the profile normally when there is no avatar image", () => {
      mockStore.conversations = [mockConversation()];

      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Открыть профиль" }));

      expect(mockNavigate).toHaveBeenCalledWith("/profile/other-1", { state: undefined });
    });
  });

  describe("composer drafts", () => {
    beforeEach(() => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation(), mockConversation({ id: "conv-2", other_username: "bob" })];
      mockStore.selectedConversationId = "conv-1";
    });

    it("does not let an edit overwrite the draft, and gives it back on cancel", async () => {
      mockStore.messages = [mockMessage()];
      render(<ChatView {...defaultProps} />);
      act(() => mockComposerProps.setDraft("мой черновик"));
      expect(readDraft("conv-1")).toBe("мой черновик");

      // Start editing a message: the composer shows the message body…
      fireEvent.click(screen.getByText("edit"));
      await waitFor(() => expect(mockComposerProps.draft).toBe("Привет"));
      // …and the reader's draft is untouched.
      expect(readDraft("conv-1")).toBe("мой черновик");

      // Cancelling the edit gives the draft back.
      fireEvent.click(screen.getByText("cancel-edit"));
      await waitFor(() => expect(mockComposerProps.draft).toBe("мой черновик"));
      expect(readDraft("conv-1")).toBe("мой черновик");
    });

    it("never hands one chat's draft to the composer of another", async () => {
      const { rerender } = render(<ChatView {...defaultProps} />);
      act(() => mockComposerProps.setDraft("черновик для alice"));
      expect(mockComposerProps.draft).toBe("черновик для alice");

      const mountsBefore = mockComposerState.mounts;
      mockComposerState.drafts = [];

      // Switch chats. The composer is keyed by the conversation, so it must be
      // mounted fresh — and never mounted or rendered with the text left behind.
      mockStore.selectedConversationId = "conv-2";
      rerender(<ChatView {...defaultProps} typingUsername="bob" />);
      await waitFor(() => expect(screen.getByTestId("composer-draft").textContent).toBe(""));

      expect(mockComposerState.mounts).toBeGreaterThan(mountsBefore);
      expect(mockComposerState.drafts).not.toContain("черновик для alice");
      expect(mockComposerProps.draft).toBe("");
      expect(readDraft("conv-1")).toBe("черновик для alice");
      expect(readDraft("conv-2")).toBe("");
    });

    it("keeps a draft per conversation instead of carrying it across chats", async () => {
      const { rerender } = render(<ChatView {...defaultProps} />);
      expect(screen.getByTestId("composer-draft").textContent).toBe("");

      // Type in the first chat, through the composer's own setter.
      act(() => mockComposerProps.setDraft("черновик для alice"));
      expect(screen.getByTestId("composer-draft").textContent).toBe("черновик для alice");

      // Switching chats must not carry the text into the next one.
      mockStore.selectedConversationId = "conv-2";
      rerender(<ChatView {...defaultProps} typingUsername="bob" />);
      await waitFor(() => expect(screen.getByTestId("composer-draft").textContent).toBe(""));

      act(() => mockComposerProps.setDraft("черновик для bob"));

      // …and coming back must not have lost the first one.
      mockStore.selectedConversationId = "conv-1";
      rerender(<ChatView {...defaultProps} />);
      await waitFor(() =>
        expect(screen.getByTestId("composer-draft").textContent).toBe("черновик для alice"),
      );
    });
  });

  it("shows the empty state when no conversation is selected", () => {
    render(<ChatView {...defaultProps} />);
    expect(screen.getByText("Выбери диалог")).toBeInTheDocument();
    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();
  });

  it("shows empty state when user is not loaded", () => {
    mockStore.conversations = [mockConversation()];
    mockStore.selectedConversationId = "conv-1";
    render(<ChatView {...defaultProps} />);
    expect(screen.getByText("Выбери диалог")).toBeInTheDocument();
  });

  describe("rendering a conversation", () => {
    beforeEach(() => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation()];
      mockStore.selectedConversationId = "conv-1";
    });

    it("renders the chat header with the peer username", () => {
      render(<ChatView {...defaultProps} />);
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("в сети")).toBeInTheDocument();
    });

    it("replaces the peer's presence with the connection state", () => {
      mockConnection.status = "connecting";
      const first = render(<ChatView {...defaultProps} />);
      expect(screen.getByText("Соединение…")).toBeInTheDocument();
      expect(screen.queryByText("в сети")).not.toBeInTheDocument();
      first.unmount();

      mockConnection.status = "offline";
      render(<ChatView {...defaultProps} />);
      expect(screen.getByText("Нет сети")).toBeInTheDocument();
      mockConnection.status = "connected";
    });

    it("shows typing indicator when the peer is typing", () => {
      render(<ChatView {...defaultProps} typingUsername="alice" />);
      expect(screen.getByText(/печатает/)).toBeInTheDocument();
    });

    it("renders messages via MessageList", () => {
      mockStore.messages = [mockMessage()];
      render(<ChatView {...defaultProps} />);
      expect(screen.getByTestId("message-list")).toBeInTheDocument();
      expect(screen.getByText("Привет")).toBeInTheDocument();
    });

    it("renders the composer", () => {
      render(<ChatView {...defaultProps} />);
      expect(screen.getByTestId("composer")).toBeInTheDocument();
    });

    it("renders the pinned message banner", () => {
      mockStore.messages = [mockMessage()];
      mockStore.conversations = [
        mockConversation({ pinned_message_id: "m1" }),
      ];
      render(<ChatView {...defaultProps} />);
      // "Привет" appears both in the message bubble and the pinned banner
      expect(screen.getAllByText("Привет").length).toBeGreaterThanOrEqual(2);
      // The banner is informational only — the "jump to the pinned message"
      // affordance went away with the scroll system.
      expect(screen.queryByRole("button", { name: "Перейти" })).not.toBeInTheDocument();
    });

    it("never renders a layout-shifting error banner", () => {
      // Errors are transient: MessengerView turns the store slot into a toast.
      // The chat itself must not reserve space for one.
      mockStore.error = "Ошибка сети";
      const { container } = render(<ChatView {...defaultProps} />);
      expect(container.querySelector(".error-banner")).not.toBeInTheDocument();
      expect(screen.queryByText("Ошибка сети")).not.toBeInTheDocument();
    });

    it("replaces the composer with an unblock panel when I blocked the peer", async () => {
      mockStore.conversations = [mockConversation({ blocked_by_me: true, other_user_id: "other-1", other_username: "alice" })];
      render(<ChatView {...defaultProps} />);

      expect(screen.queryByTestId("composer")).not.toBeInTheDocument();
      expect(screen.getByText("Вы заблокировали @alice")).toBeInTheDocument();
      expect(screen.getByText(/Сообщения и звонки недоступны/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Разблокировать" }));

      await waitFor(() => expect(mockUnblockUser).toHaveBeenCalledWith("other-1"));
      expect(mockStore.setConversationBlockedByMe).toHaveBeenCalledWith("conv-1", false);
    });

    it("keeps the composer when the peer blocked me (no disclosure)", () => {
      // The blocked side gets no flag at all: the composer stays, only the
      // peer's presence is hidden by the server.
      mockStore.conversations = [mockConversation({ blocked_by_me: false })];
      render(<ChatView {...defaultProps} />);
      expect(screen.getByTestId("composer")).toBeInTheDocument();
      expect(screen.queryByText(/Вы заблокировали/)).not.toBeInTheDocument();
    });

    it("opens the user info panel on header click", () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("alice"));
      expect(screen.getByTestId("user-info-panel")).toBeInTheDocument();
    });

    it("closes the user info panel", () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("alice"));
      fireEvent.click(screen.getByText("close-panel"));
      expect(screen.queryByTestId("user-info-panel")).not.toBeInTheDocument();
    });
  });

  describe("message actions", () => {
    beforeEach(() => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation()];
      mockStore.selectedConversationId = "conv-1";
      mockStore.messages = [mockMessage()];
    });

    it("replies to a message", async () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getAllByText("reply")[0]);
      await waitFor(() => {
        expect(mockComposerProps.replyToMessage).toBeTruthy();
      });
      expect(mockComposerProps.replyToMessage.id).toBe("m1");
    });

    it("starts editing a message", () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("edit"));
      expect(mockComposerProps.editingMessageId).toBe("m1");
      expect(mockComposerProps.editingContent).toBe("Привет");
    });

    it("focuses the composer when starting an edit so the keyboard opens", () => {
      const focus = vi.fn();
      render(
        <ChatView
          {...defaultProps}
          composerRef={{
            current: {
              focus,
              insertText: vi.fn(),
              clear: vi.fn(),
              insertEmoji: vi.fn(),
              getEditor: () => null,
            },
          }}
        />,
      );
      fireEvent.click(screen.getByText("edit"));
      expect(focus).toHaveBeenCalledOnce();
    });

    it("deletes a message", async () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("delete"));
      expect(mockStore.deleteMessage).toHaveBeenCalledWith("m1");
    });

    it("sends a new message via the composer", async () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("set-draft"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => {
        expect(mockStore.sendMessage).toHaveBeenCalled();
      });
      expect(mockStore.sendMessage).toHaveBeenCalledWith(
        "hello",
        expect.any(String),
        undefined,
        undefined
      );
    });

    it("saves an edit via the composer", async () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("edit"));
      fireEvent.click(screen.getByText("save-edit"));
      await waitFor(() => {
        expect(mockStore.editMessage).toHaveBeenCalledWith("m1", "edited");
      });
    });

    it("does not send when draft is empty", async () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("send"));
      expect(mockStore.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("notes chat", () => {
    beforeEach(() => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [
        mockConversation({ id: "notes-1", is_notes: true, other_username: null, member_count: 0 }),
      ];
      mockStore.selectedConversationId = "notes-1";
    });

    it("shows the notes header", () => {
      render(<ChatView {...defaultProps} />);
      expect(screen.getByText("Заметки")).toBeInTheDocument();
    });

    it("shows pinned notes as one compact bar, keeping them in the flow", () => {
      mockStore.messages = [
        mockMessage({ id: "n1", content: "Закреплённая заметка", notesPinned: true }),
        mockMessage({ id: "n2", content: "Обычная заметка", notesPinned: false }),
      ];
      const { container } = render(<ChatView {...defaultProps} />);
      // The bar is one row with a counter, not a section of full messages.
      expect(container.querySelector(".notes-pinned-banner")).toBeInTheDocument();
      expect(screen.getByText("Закреплённые заметки")).toBeInTheDocument();
      expect(screen.getByText("1/1")).toBeInTheDocument();
      expect(container.querySelector(".notes-pinned-section")).not.toBeInTheDocument();
      // Both notes stay in the chronological list (the pinned one also appears
      // as the bar's preview).
      expect(screen.getAllByText("Закреплённая заметка").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Обычная заметка")).toBeInTheDocument();
    });

    it("filters notes by folder", async () => {
      mockStore.messages = [
        mockMessage({ id: "n1", content: "Рабочая", notesFolder: "Работа", notesPinned: false }),
        mockMessage({ id: "n2", content: "Личная", notesFolder: "Личное", notesPinned: false }),
      ];
      render(<ChatView {...defaultProps} />);

      fireEvent.click(screen.getByRole("button", { name: "Работа" }));

      await waitFor(() => {
        expect(screen.queryByText("Личная")).not.toBeInTheDocument();
        expect(screen.getByText("Рабочая")).toBeInTheDocument();
      });
    });

    it("shows empty notes state when there are no messages", () => {
      render(<ChatView {...defaultProps} />);
      expect(screen.getByText("Личные Заметки")).toBeInTheDocument();
    });

    it("opens notes settings dialog from the header", () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.click(screen.getByText("Заметки"));
      expect(screen.getByTestId("notes-settings")).toBeInTheDocument();
    });
  });

  describe("escape key", () => {
    it("calls onBack when Escape is pressed", () => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation()];
      mockStore.selectedConversationId = "conv-1";
      const onBack = vi.fn();
      render(<ChatView {...defaultProps} onBack={onBack} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onBack).toHaveBeenCalled();
    });

    it("does not navigate back while editing", () => {
      mockStore.me = { id: "me-1", username: "me" };
      mockStore.conversations = [mockConversation()];
      mockStore.selectedConversationId = "conv-1";
      mockStore.messages = [mockMessage()];
      const onBack = vi.fn();
      render(<ChatView {...defaultProps} onBack={onBack} />);
      fireEvent.click(screen.getByText("edit"));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onBack).not.toHaveBeenCalled();
    });
  });
});
