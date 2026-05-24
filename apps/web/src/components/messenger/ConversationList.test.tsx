import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConversationList } from "./ConversationList";
import type { ConversationView, ProfileSummary } from "./types";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: ({ size }: any) => <span data-testid={`loader-${size}`}>Loading...</span>,
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: any) => <span data-testid="user-badge">{username}</span>,
}));

vi.mock("@/components/OnlineStatus", () => ({
  OnlineStatus: ({ isOnline, showText }: any) => (
    <span data-testid="online-status" data-online={isOnline}>
      {showText !== false ? (isOnline ? "online" : "offline") : null}
    </span>
  ),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, key?: string | null) => key || null,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeProfile = (overrides: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id: "user-1",
  username: "testuser",
  avatar_url: null,
  account_number: 1234,
  is_online: null,
  last_seen_at: null,
  ...overrides,
});

const makeConversation = (overrides: Partial<ConversationView> = {}): ConversationView => ({
  id: "conv-1",
  unreadCount: 0,
  lastReadAt: null,
  lastMessageAt: null,
  pinnedMessageId: null,
  otherUser: {
    ...makeProfile({ id: "other-1", username: "otheruser" }),
    publicKey: null,
  },
  ...overrides,
});

const defaultProps = {
  conversations: [] as ConversationView[],
  selectedConversationId: null as string | null,
  openConversation: vi.fn(),
  conversationsLoading: false,
  errorMessage: null as string | null,
  startingConversation: false,
  targetUserId: null as string | null,
  ensureConversation: vi.fn(),
  loadConversations: vi.fn(),
  me: makeProfile(),
  totalUnread: 0,
  onDismissError: vi.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConversationList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("header", () => {
    it("renders title 'Сообщения'", () => {
      render(<ConversationList {...defaultProps} />);
      expect(screen.getByText("Сообщения")).toBeInTheDocument();
    });

    it("shows total unread badge when totalUnread > 0", () => {
      render(<ConversationList {...defaultProps} totalUnread={5} />);
      const badge = screen.getByText("5");
      expect(badge.className).toContain("header-unread-badge");
    });

    it("does not show total unread badge when totalUnread is 0", () => {
      render(<ConversationList {...defaultProps} totalUnread={0} />);
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });
  });

  describe("error banner", () => {
    it("renders error message when errorMessage is set", () => {
      const { container } = render(<ConversationList {...defaultProps} errorMessage="Что-то пошло не так" />);
      expect(screen.getByText("Что-то пошло не так")).toBeInTheDocument();
      expect(container.querySelector(".error-banner")).toBeInTheDocument();
    });

    it("does not render error banner when errorMessage is null", () => {
      render(<ConversationList {...defaultProps} />);
      expect(screen.queryByText(/Что-то пошло не так/)).not.toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows loader when conversationsLoading and conversations empty", () => {
      render(<ConversationList {...defaultProps} conversationsLoading={true} />);
      expect(screen.getByTestId("loader-md")).toBeInTheDocument();
    });

    it("does not show loader when conversationsLoading but conversations exist", () => {
      render(
        <ConversationList
          {...defaultProps}
          conversationsLoading={true}
          conversations={[makeConversation()]}
        />,
      );
      expect(screen.queryByTestId("loader-md")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when no conversations", () => {
      render(<ConversationList {...defaultProps} />);
      expect(screen.getByText("Диалогов пока нет.")).toBeInTheDocument();
    });

    it("shows 'Открыть диалог' button when targetUserId is set", () => {
      render(<ConversationList {...defaultProps} targetUserId="other-1" />);
      expect(screen.getByText("Открыть диалог")).toBeInTheDocument();
    });

    it("shows loader on button when startingConversation is true", () => {
      render(
        <ConversationList {...defaultProps} targetUserId="other-1" startingConversation={true} />,
      );
      expect(screen.getByTestId("loader-sm")).toBeInTheDocument();
      expect(screen.queryByText("Открыть диалог")).not.toBeInTheDocument();
    });

    it("calls ensureConversation then loadConversations on button click", async () => {
      const ensureConversation = vi.fn().mockResolvedValue("conv-new");
      const loadConversations = vi.fn().mockResolvedValue([]);
      const me = makeProfile({ id: "me-1" });

      render(
        <ConversationList
          {...defaultProps}
          targetUserId="other-1"
          ensureConversation={ensureConversation}
          loadConversations={loadConversations}
          me={me}
        />,
      );

      await userEvent.click(screen.getByText("Открыть диалог"));

      await waitFor(() => {
        expect(ensureConversation).toHaveBeenCalledWith("me-1", "other-1");
      });
      await waitFor(() => {
        expect(loadConversations).toHaveBeenCalledWith("me-1");
      });
    });

    it("does not show 'Открыть диалог' when targetUserId is null", () => {
      render(<ConversationList {...defaultProps} targetUserId={null} />);
      expect(screen.queryByText("Открыть диалог")).not.toBeInTheDocument();
    });
  });

  describe("conversation cards", () => {
    const conversations = [
      makeConversation({
        id: "conv-1",
        otherUser: {
          ...makeProfile({
            id: "other-1",
            username: "alice",
            avatar_url: null,
            account_number: 1001,
          }),
          publicKey: null,
        },
        unreadCount: 2,
      }),
      makeConversation({
        id: "conv-2",
        otherUser: {
          ...makeProfile({
            id: "other-2",
            username: "bob",
            avatar_url: "avatar.jpg",
            account_number: 1002,
            is_online: true,
          }),
          publicKey: null,
        },
        unreadCount: 0,
      }),
    ];

    it("renders conversation cards", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      expect(screen.getByText("alice")).toBeInTheDocument();
      expect(screen.getByText("bob")).toBeInTheDocument();
    });

    it("renders account numbers", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      expect(screen.getByText("#1001")).toBeInTheDocument();
      expect(screen.getByText("#1002")).toBeInTheDocument();
    });

    it("highlights selected conversation with is-active class", () => {
      const { container } = render(
        <ConversationList {...defaultProps} conversations={conversations} selectedConversationId="conv-1" />,
      );

      const cards = container.querySelectorAll(".conversation-card");
      expect(cards[0].className).toContain("is-active");
      expect(cards[1].className).not.toContain("is-active");
    });

    it("shows unread count badge when conversation has unread", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("calls openConversation with conversation on card click", async () => {
      const openConversation = vi.fn();
      render(
        <ConversationList
          {...defaultProps}
          conversations={conversations}
          openConversation={openConversation}
        />,
      );

      await userEvent.click(screen.getByText("alice"));

      expect(openConversation).toHaveBeenCalledWith(conversations[0]);
    });

    it("renders avatar image for users with avatar_url", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      const imgs = screen.getAllByRole("img");
      // bob has avatar_url = "avatar.jpg"
      const bobImg = imgs.find((img) => img.getAttribute("alt") === "bob");
      expect(bobImg).toBeInTheDocument();
    });

    it("renders initials for users without avatar_url", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      // alice has no avatar_url, shows initials "AL"
      expect(screen.getByText("AL")).toBeInTheDocument();
    });

    it("renders OnlineStatus for each conversation", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      const statuses = screen.getAllByTestId("online-status");
      expect(statuses.length).toBe(2);
    });

    it("renders UserBadge for each conversation", () => {
      render(<ConversationList {...defaultProps} conversations={conversations} />);
      const badges = screen.getAllByTestId("user-badge");
      expect(badges.length).toBe(2);
    });
  });


  describe("edge cases", () => {
    it("handles missing account_number gracefully", () => {
      const conv = makeConversation({
        otherUser: {
          ...makeProfile({ account_number: null }),
          publicKey: null,
        },
      });
      render(<ConversationList {...defaultProps} conversations={[conv]} />);
      expect(screen.getByText("#?")).toBeInTheDocument();
    });

    it("handles missing lastMessageAt", () => {
      const conv = makeConversation({ lastMessageAt: null });
      render(<ConversationList {...defaultProps} conversations={[conv]} />);
      expect(screen.getByText("сейчас")).toBeInTheDocument();
    });
  });
});
