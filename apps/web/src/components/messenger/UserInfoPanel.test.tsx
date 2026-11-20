import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UserInfoPanel } from "./UserInfoPanel";

const { api, apiClient, store } = vi.hoisted(() => ({
  api: {
    listBlocks: vi.fn().mockResolvedValue([]),
    blockUser: vi.fn().mockResolvedValue({ blocked: true }),
    unblockUser: vi.fn().mockResolvedValue({ blocked: false }),
    setMuted: vi.fn().mockResolvedValue({ muted: true }),
    listSharedAttachments: vi.fn().mockResolvedValue([]),
    getGroupMembers: vi.fn().mockResolvedValue([]),
    addGroupMembers: vi.fn().mockResolvedValue({ added: 1 }),
  },
  apiClient: { request: vi.fn().mockResolvedValue({ success: true, data: [] }) },
  store: { setConversationMuted: vi.fn() },
}));

vi.mock("@/services/messengerApi", () => ({ messengerApi: api }));
vi.mock("@/integrations/api/client", () => ({ apiClient }));
vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: (selector: (state: typeof store) => unknown) => selector(store),
}));
vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, key?: string | null) => key || null,
  giftImageUrl: (key?: string | null) => key || null,
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: ({ alt }: { alt?: string }) => <span data-testid="avatar">{alt}</span>,
}));
vi.mock("@/components/NicknameEmoji", () => ({ NicknameEmoji: () => null }));
vi.mock("./utils", () => ({
  formatPresence: (online: boolean | null) => (online ? "в сети" : "не в сети"),
  getInitials: (name: string) => name.slice(0, 2).toUpperCase(),
  getGroupInitials: (name: string | null) => (name || "ГР").slice(0, 2).toUpperCase(),
}));
vi.mock("@/components/DropsBalance", () => ({ DropsBalance: () => null }));
vi.mock("./attachmentMedia", () => ({
  useAuthenticatedAttachmentUrl: (_attachment: unknown, key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

function media(id: string, type: "image" | "video", messageId = "msg-1") {
  return {
    id,
    message_id: messageId,
    url: `user-1/messenger/${id}.jpg`,
    type,
    name: `${id}.jpg`,
    size: 2048,
    mime: "image/jpeg",
    meta: JSON.stringify({ preview_key: `user-1/messenger/${id}-preview.jpg` }),
    created_at: "2026-01-01T10:00:00Z",
  };
}

const baseProps = {
  open: true,
  onClose: vi.fn(),
  conversationId: "conv-1",
  userId: "user-1",
  username: "alice",
  displayName: "Алиса",
  avatarUrl: null,
  isOnline: true,
  lastSeenAt: null,
  isMuted: false,
  onJumpToMessage: vi.fn(),
};

describe("UserInfoPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listBlocks.mockResolvedValue([]);
    api.listSharedAttachments.mockResolvedValue([]);
    apiClient.request.mockResolvedValue({ success: true, data: [] });
  });

  it("renders a clean Telegram-style profile card", () => {
    render(<UserInfoPanel {...baseProps} />);

    expect(screen.getByText("Алиса")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("в сети")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Профиль" })).toBeInTheDocument();
    // The notification switch is on by default.
    expect(screen.getByRole("button", { name: /Уведомления/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("mutes optimistically and persists the choice", async () => {
    render(<UserInfoPanel {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /Уведомления/ }));

    await waitFor(() => expect(api.setMuted).toHaveBeenCalledWith("conv-1", true));
    expect(store.setConversationMuted).toHaveBeenCalledWith("conv-1", true);
    expect(screen.getByRole("button", { name: /Уведомления/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Выключены")).toBeInTheDocument();
  });

  it("shows shared media and jumps to the message it came from", async () => {
    const onClose = vi.fn();
    const onJumpToMessage = vi.fn();
    api.listSharedAttachments.mockImplementation(async (_id, types) =>
      types.includes("image") ? [media("a1", "image", "msg-7")] : [],
    );

    const { container } = render(
      <UserInfoPanel {...baseProps} onClose={onClose} onJumpToMessage={onJumpToMessage} />,
    );

    await waitFor(() => expect(container.querySelectorAll(".user-info-media-tile")).toHaveLength(1));
    expect(api.listSharedAttachments).toHaveBeenCalledWith("conv-1", ["image", "video"], 9);

    fireEvent.click(container.querySelector(".user-info-media-tile") as HTMLElement);
    expect(onJumpToMessage).toHaveBeenCalledWith("msg-7");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders files in their own compact section", async () => {
    api.listSharedAttachments.mockImplementation(async (_id, types) =>
      types.includes("file")
        ? [{ ...media("doc", "image", "msg-9"), type: "file", name: "notes.pdf" }]
        : [],
    );
    render(<UserInfoPanel {...baseProps} />);

    await waitFor(() => expect(screen.getByText("notes.pdf")).toBeInTheDocument());
    expect(screen.getByText("Файлы")).toBeInTheDocument();
  });

  it("keeps an empty media state instead of an empty grid", async () => {
    render(<UserInfoPanel {...baseProps} />);
    await waitFor(() => expect(screen.getByText("Пока нет фото и видео")).toBeInTheDocument());
  });

  it("blocks after an explicit confirmation", async () => {
    render(<UserInfoPanel {...baseProps} />);
    await waitFor(() => expect(api.listBlocks).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /^Заблокировать/ }));
    // The destructive row opens a confirmation, it does not block immediately.
    expect(api.blockUser).not.toHaveBeenCalled();
    expect(screen.getByText("Заблокировать @alice?")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Заблокировать" }));
    await waitFor(() => expect(api.blockUser).toHaveBeenCalledWith("user-1"));
  });

  it("offers unblocking for an already blocked user", async () => {
    api.listBlocks.mockResolvedValue([
      { user_id: "user-1", username: "alice", display_name: "Алиса", blocked_at: "2026-01-01T00:00:00Z" },
    ]);
    render(<UserInfoPanel {...baseProps} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Разблокировать/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Разблокировать/ }));
    await waitFor(() => expect(api.unblockUser).toHaveBeenCalledWith("user-1"));
  });
});
