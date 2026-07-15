import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationList } from "./ConversationList";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: ({ size }: { size: string }) => <span data-testid={`loader-${size}`}>Loading...</span>,
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: { username: string }) => <span data-testid="user-badge">{username}</span>,
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, key?: string | null) => key || null,
}));

// ─── Mock zustand store ──────────────────────────────────────────────────────

const mockSelectConversation = vi.fn();
const mockSetError = vi.fn();
const mockStore = {
  conversations: [] as any[],
  selectedConversationId: null as string | null,
  selectConversation: mockSelectConversation,
  error: null as string | null,
  setError: mockSetError,
  isInitialLoading: false,
  totalUnread: () => 0,
};

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: vi.fn((selector: (s: typeof mockStore) => unknown) => {
    return selector(mockStore);
  }),
  selectTotalUnread: (s: typeof mockStore) => typeof s.totalUnread === "function" ? s.totalUnread() : 0,
  selectSelectedConversation: (s: typeof mockStore) => s.conversations.find((c: { id: string }) => c.id === s.selectedConversationId) ?? null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    last_message_at: "2025-06-01T12:00:00Z",
    last_message_preview: "Hello!",
    last_message_sender_id: "u2",
    pinned_message_id: null,
    updated_at: "2025-06-01T12:00:00Z",
    unread_count: 0,
    other_user_id: "other-1",
    other_username: "alice",
    other_avatar_url: null,
    other_account_number: 1001,
    other_is_online: null,
    other_last_seen_at: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConversationList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.conversations = [];
    mockStore.selectedConversationId = null;
    mockStore.error = null;
    mockStore.isInitialLoading = false;
    mockStore.totalUnread = () => 0;
  });

  describe("header", () => {
    it("renders title 'Сообщения'", () => {
      render(<ConversationList />);
      expect(screen.getByText("Сообщения")).toBeInTheDocument();
    });

    it("shows total unread badge when totalUnread > 0", () => {
      mockStore.totalUnread = () => 5;
      render(<ConversationList />);
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("shows 99+ for > 99 unread", () => {
      mockStore.totalUnread = () => 150;
      render(<ConversationList />);
      expect(screen.getByText("99+")).toBeInTheDocument();
    });

    it("does not show badge when totalUnread is 0", () => {
      mockStore.totalUnread = () => 0;
      render(<ConversationList />);
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });
  });

  describe("error banner", () => {
    it("renders error message", () => {
      mockStore.error = "Что-то пошло не так";
      render(<ConversationList />);
      expect(screen.getByText("Что-то пошло не так")).toBeInTheDocument();
    });

    it("dismisses error on close button click", async () => {
      mockStore.error = "Test error";
      render(<ConversationList />);
      const dismissBtn = screen.getByLabelText("Закрыть");
      await userEvent.click(dismissBtn);
      expect(mockSetError).toHaveBeenCalledWith(null);
    });
  });

  describe("loading state", () => {
    it("shows loader when loading and no conversations", () => {
      mockStore.isInitialLoading = true;
      render(<ConversationList />);
      expect(screen.getByTestId("loader-md")).toBeInTheDocument();
    });

    it("does not show loader when conversations exist", () => {
      mockStore.conversations = [mockConversation()];
      mockStore.isInitialLoading = true;
      render(<ConversationList />);
      expect(screen.queryByTestId("loader-md")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when no conversations", () => {
      render(<ConversationList />);
      expect(screen.getByText("Диалогов пока нет.")).toBeInTheDocument();
    });

    it("shows 'Открыть диалог' button when targetUserId is set", () => {
      const onStartChat = vi.fn();
      render(<ConversationList onStartChat={onStartChat} targetUserId="other-1" />);
      expect(screen.getByText("Открыть диалог")).toBeInTheDocument();
    });

    it("shows loader on button when startingChat is true", () => {
      render(<ConversationList onStartChat={vi.fn()} targetUserId="other-1" startingChat={true} />);
      expect(screen.getByTestId("loader-sm")).toBeInTheDocument();
      expect(screen.queryByText("Открыть диалог")).not.toBeInTheDocument();
    });

    it("calls onStartChat on button click", async () => {
      const onStartChat = vi.fn();
      render(<ConversationList onStartChat={onStartChat} targetUserId="other-1" />);
      await userEvent.click(screen.getByText("Открыть диалог"));
      expect(onStartChat).toHaveBeenCalledWith("other-1");
    });
  });

  describe("conversation cards", () => {
    const conversations = [
      mockConversation({
        id: "conv-1",
        other_username: "alice",
        other_user_id: "other-1",
      }),
      mockConversation({
        id: "conv-2",
        other_username: "bob",
        other_user_id: "other-2",
        other_avatar_url: "avatar.jpg",
        other_is_online: true,
      }),
    ];

    it("renders conversation cards", () => {
      mockStore.conversations = conversations;
      render(<ConversationList />);
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
    });

    it("highlights selected conversation", () => {
      mockStore.conversations = conversations;
      mockStore.selectedConversationId = "conv-1";
      const { container } = render(<ConversationList />);
      const cards = container.querySelectorAll(".conversation-card");
      expect(cards[0]!.className).toContain("is-active");
      expect(cards[1]!.className).not.toContain("is-active");
    });

    it("shows unread count badge", () => {
      mockStore.conversations = [mockConversation({ id: "conv-1", unread_count: 3 })];
      render(<ConversationList />);
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("selects conversation on card click", async () => {
      mockStore.conversations = conversations;
      render(<ConversationList />);
      await userEvent.click(screen.getByText("alice"));
      expect(mockSelectConversation).toHaveBeenCalledWith("conv-1");
    });

    it("renders username in UserBadge", () => {
      mockStore.conversations = conversations;
      render(<ConversationList />);
      const badges = screen.getAllByTestId("user-badge");
      expect(badges).toHaveLength(2);
    });
  });
});
