import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareSheet } from "./ShareSheet";
import type { ConversationView } from "@/components/messenger/types";

// ─── Hoisted state (accessible from vi.mock factories) ──────────────────────

const h = vi.hoisted(() => {
  const store = {
    me: { id: "me", username: "meuser" },
    conversations: [] as ConversationView[],
    init: vi.fn(async () => {}),
    loadConversations: vi.fn(async () => {}),
    sendMessage: vi.fn(
      async (_content: string, _clientId: string, _parentId?: string, _attachments?: unknown, _conversationId?: string) =>
        "msg-1",
    ),
    createConversation: vi.fn(async (_userId: string) => "conv-new"),
  };
  const useMessengerStore = vi.fn((selector: (s: typeof store) => unknown) => selector(store));
  (useMessengerStore as unknown as { getState: () => typeof store }).getState = () => store;
  const navigate = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn() };
  const searchProfiles = vi.fn(async (_query: string) => [] as { id: string; username: string }[]);
  return { store, useMessengerStore, navigate, toast, searchProfiles };
});

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: h.useMessengerStore,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
}));

vi.mock("sonner", () => ({
  toast: h.toast,
}));

vi.mock("@/utils/searchProfiles", () => ({
  searchProfiles: (query: string) => h.searchProfiles(query),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

// The desktop path renders a Radix Dialog (fine in jsdom); the mobile path uses
// vaul's Drawer which needs matchMedia plumbing — stub it to a plain container.
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: any) => <>{children}</>,
  DrawerContent: ({ children }: any) => <div data-testid="drawer-content">{children}</div>,
  DrawerHeader: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <div>{children}</div>,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockConversation(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "conv-1",
    last_message_at: "2025-06-01T12:00:00Z",
    last_message_preview: "Привет!",
    last_message_sender_id: "u2",
    pinned_message_id: null,
    updated_at: "2025-06-01T12:00:00Z",
    unread_count: 0,
    is_muted: false,
    other_user_id: "u2",
    other_username: "alice",
    other_display_name: null,
    other_nickname_emoji_id: null,
    other_avatar_url: null,
    other_account_number: 1001,
    other_is_online: null,
    other_last_seen_at: null,
    is_group: false,
    group_name: null,
    group_avatar_url: null,
    member_count: 2,
    ...overrides,
  };
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  target: { type: "thread" as const, id: "t1" },
  url: "https://gomo6.wtf/games/thread/t1",
  title: "Заголовок треда",
};

function renderSheet(props: Partial<typeof baseProps> = {}) {
  return render(<ShareSheet {...baseProps} {...props} />);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ShareSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.store.conversations = [];
    h.searchProfiles.mockResolvedValue([]);
  });

  it("renders recent conversations and the socials row in the pick phase", async () => {
    h.store.conversations = [mockConversation()];
    renderSheet();

    expect(await screen.findByText("Недавние чаты")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ссылка/ })).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("VK")).toBeInTheDocument();
  });

  it("swaps the bottom panel for the compose phase when a contact is picked", async () => {
    h.store.conversations = [mockConversation()];
    renderSheet();

    await screen.findByText("alice");
    await userEvent.click(screen.getByText("alice"));

    expect(screen.getByPlaceholderText("Сообщение (необязательно)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeInTheDocument();
    expect(screen.queryByText("Telegram")).not.toBeInTheDocument();
  });

  it("sends the share card to the chosen conversation", async () => {
    h.store.conversations = [mockConversation()];
    renderSheet();

    await screen.findByText("alice");
    await userEvent.click(screen.getByText("alice"));
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(h.store.sendMessage).toHaveBeenCalledTimes(1);
      expect(h.store.sendMessage).toHaveBeenCalledWith(
        "__SHARE__:thread:t1",
        expect.any(String),
        undefined,
        undefined,
        "conv-1",
      );
      expect(h.toast.success).toHaveBeenCalledWith("Отправлено", expect.anything());
      expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("sends the optional text as a reply to the share card", async () => {
    h.store.conversations = [mockConversation()];
    renderSheet();

    await screen.findByText("alice");
    await userEvent.click(screen.getByText("alice"));
    await userEvent.type(screen.getByPlaceholderText("Сообщение (необязательно)"), "Смотри, что нашёл");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(h.store.sendMessage).toHaveBeenCalledTimes(2);
      const calls = h.store.sendMessage.mock.calls;
      expect(calls[0]![0]).toBe("__SHARE__:thread:t1");
      // Second message replies to the first one's id.
      expect(calls[1]![0]).toBe("Смотри, что нашёл");
      expect(calls[1]![2]).toBe("msg-1");
      expect(calls[1]![4]).toBe("conv-1");
    });
  });

  it("creates a new conversation when the picked user has no chat yet", async () => {
    h.searchProfiles.mockResolvedValue([{ id: "u-new", username: "newuser" }]);
    renderSheet();

    const search = await screen.findByPlaceholderText("Найти чат или пользователя…");
    await userEvent.type(search, "newuser");

    expect(await screen.findByText("Начать чат")).toBeInTheDocument();
    await userEvent.click(screen.getByText("@newuser"));

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(h.store.createConversation).toHaveBeenCalledWith("u-new");
      expect(h.store.sendMessage).toHaveBeenCalledWith(
        "__SHARE__:thread:t1",
        expect.any(String),
        undefined,
        undefined,
        "conv-new",
      );
    });
  });

  it("deselects a contact when the same row is clicked again", async () => {
    h.store.conversations = [mockConversation()];
    renderSheet();

    await screen.findByText("alice");
    await userEvent.click(screen.getByRole("button", { name: /alice/ }));
    expect(screen.getByPlaceholderText("Сообщение (необязательно)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /alice/ }));
    expect(screen.queryByPlaceholderText("Сообщение (необязательно)")).not.toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
  });

  it("copies the link from the bottom row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderSheet();

    await userEvent.click(screen.getByRole("button", { name: /Ссылка/ }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://gomo6.wtf/games/thread/t1");
      expect(h.toast.success).toHaveBeenCalledWith("Ссылка скопирована");
    });
  });
});
