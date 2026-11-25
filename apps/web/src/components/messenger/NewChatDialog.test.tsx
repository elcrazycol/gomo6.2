import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewChatDialog } from "./NewChatDialog";

const { store, friends, api, apiClient } = vi.hoisted(() => ({
  store: {
    conversations: [
      {
        id: "conv-1",
        is_group: false,
        is_notes: false,
        other_user_id: "user-recent",
        other_username: "recent",
        other_display_name: "Недавний",
        other_avatar_url: null,
        other_is_online: true,
        other_last_seen_at: null,
      },
    ],
    selectConversation: vi.fn(),
    createConversation: vi.fn().mockResolvedValue("conv-new"),
  },
  friends: {
    friends: [
      {
        friendship_id: "f1",
        user_id: "user-friend",
        username: "friend",
        display_name: "Друг",
        avatar_url: null,
        is_online: false,
      },
    ],
    fetchFriends: vi.fn().mockResolvedValue(undefined),
  },
  api: { createGroup: vi.fn().mockResolvedValue({ conversation_id: "conv-group" }) },
  apiClient: { request: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("@/stores/friendsStore", () => ({
  useFriendsStore: (selector: (state: typeof friends) => unknown) => selector(friends),
}));

vi.mock("@/services/messengerApi", () => ({ messengerApi: api }));
vi.mock("@/integrations/api/client", () => ({ apiClient }));
vi.mock("@/utils/storage", () => ({ storageUrl: (_bucket: string, key?: string | null) => key || null }));
vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <span data-testid="loader" />,
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: ({ alt }: { alt?: string }) => <span data-testid="avatar">{alt}</span>,
}));
vi.mock("./utils", () => ({
  getInitials: (name: string) => name.slice(0, 2).toUpperCase(),
  formatPresence: (online: boolean | null) => (online ? "в сети" : "был(а) недавно"),
}));

describe("NewChatDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.createConversation.mockResolvedValue("conv-new");
    api.createGroup.mockResolvedValue({ conversation_id: "conv-group" });
    apiClient.request.mockResolvedValue({ success: true, data: [] });
  });

  it("opens straight into search and offers recent chats and friends", async () => {
    render(<NewChatDialog open onClose={vi.fn()} />);

    const input = screen.getByRole("searchbox", { name: "Поиск пользователей" });
    // The reader's first action is typing — the field already has focus.
    await waitFor(() => expect(input).toHaveFocus());

    expect(screen.getByText("Недавние")).toBeInTheDocument();
    expect(screen.getByText("Недавний")).toBeInTheDocument();
    expect(screen.getByText("Друзья")).toBeInTheDocument();
    expect(screen.getByText("Друг")).toBeInTheDocument();
  });

  it("starts a 1:1 chat in one click on a recent row", () => {
    const onClose = vi.fn();
    render(<NewChatDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Недавний/ }));
    expect(store.selectConversation).toHaveBeenCalledWith("conv-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("creates a chat with a friend in one click", async () => {
    const onClose = vi.fn();
    render(<NewChatDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Друг/ }));
    await waitFor(() => expect(store.createConversation).toHaveBeenCalledWith("user-friend"));
    expect(store.selectConversation).toHaveBeenCalledWith("conv-new");
    expect(onClose).toHaveBeenCalled();
  });

  it("searches users and opens the result", async () => {
    apiClient.request.mockResolvedValueOnce({
      success: true,
      data: [{ id: "user-found", username: "found", display_name: "Найденный", avatar_url: null }],
    });
    const onClose = vi.fn();
    render(<NewChatDialog open onClose={onClose} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск пользователей" }), {
      target: { value: "found" },
    });

    await waitFor(() => expect(screen.getByText("Найденный")).toBeInTheDocument());
    expect(apiClient.request).toHaveBeenCalledWith("/api/v1/drops/users/search?q=found");

    fireEvent.click(screen.getByRole("button", { name: /Найденный/ }));
    await waitFor(() => expect(store.createConversation).toHaveBeenCalledWith("user-found"));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps group creation a secondary row above the list", async () => {
    const onClose = vi.fn();
    render(<NewChatDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const nameInput = screen.getByLabelText("Название группы");
    fireEvent.change(nameInput, { target: { value: "Книжный клуб" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));

    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Книжный клуб", []));
    expect(onClose).toHaveBeenCalled();
  });

  it("autofocuses the group name in group mode", async () => {
    render(<NewChatDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    await waitFor(() => expect(screen.getByLabelText("Название группы")).toHaveFocus());
  });
});
