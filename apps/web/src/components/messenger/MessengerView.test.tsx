import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MessengerView } from "./MessengerView";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockStore } = vi.hoisted(() => {
  return {
    mockStore: {
      init: vi.fn().mockResolvedValue(undefined),
      isInitialLoading: false,
      selectConversation: vi.fn(),
      selectedConversationId: null,
      createConversation: vi.fn().mockResolvedValue("conv-9"),
      typingUsers: {},
      conversations: [] as any[],
      me: null,
    },
  };
});

const mockWs = vi.hoisted(() => ({
  connect: vi.fn(),
  stopTyping: vi.fn(),
  sendTyping: vi.fn(),
}));

const mockEventManager = vi.hoisted(() => ({
  subscribeConversation: vi.fn(),
  unsubscribeConversation: vi.fn(),
}));

const mockSetSearchParams = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("@/stores/messengerStore", () => ({
  useMessengerStore: Object.assign(vi.fn((selector: any) => selector(mockStore)), {
    getState: () => mockStore,
    setState: () => {},
  }),
  selectSelectedConversation: (s: any) =>
    s.conversations.find((c: any) => c.id === s.selectedConversationId) ?? null,
}));

vi.mock("@/services/messengerWebSocket", () => ({
  messengerWs: mockWs,
}));

vi.mock("@/services/eventManager", () => ({
  eventManager: mockEventManager,
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: ({ size }: { size: string }) => (
    <span data-testid={`loader-${size}`}>Loading...</span>
  ),
}));

vi.mock("./ErrorBoundary", () => ({
  MessengerErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./ConversationList", () => ({
  ConversationList: ({ onStartChat, onSelectConversation, targetUserId, isCollapsed }: any) => (
    <div data-testid="conversation-list" data-target={targetUserId || ""} data-collapsed={String(isCollapsed)}>
      <button onClick={() => onStartChat("other-1")}>start-chat</button>
      <button onClick={() => onSelectConversation("conv-1")}>select-conv</button>
    </div>
  ),
}));

vi.mock("./ChatView", () => ({
  ChatView: ({ onBack, typingUsername, onTyping }: any) => (
    <div data-testid="chat-view">
      <span data-testid="typing">{typingUsername || "none"}</span>
      <button onClick={() => onTyping(true)}>set-typing</button>
      <button onClick={onBack}>back</button>
    </div>
  ),
}));

function mockConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    last_message_at: "2025-06-01T12:00:00Z",
    last_message_preview: "Hello",
    unread_count: 0,
    other_user_id: "other-1",
    other_username: "alice",
    is_notes: false,
    is_group: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.isInitialLoading = false;
  mockStore.selectedConversationId = null;
  mockStore.conversations = [];
  mockSearchParams.delete("conversation");
  mockSearchParams.delete("user");
  mockWs.connect.mockResolvedValue(undefined);
  mockStore.createConversation.mockResolvedValue("conv-9");
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.classList.remove("messenger-mobile-chat-active");
  // Ensure a failing mobile test cannot leak a matchMedia override into others
  if ((globalThis as any).__origMatchMedia) {
    window.matchMedia = (globalThis as any).__origMatchMedia;
    delete (globalThis as any).__origMatchMedia;
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MessengerView", () => {
  it("initializes the store and connects WS on mount", () => {
    render(<MessengerView />);
    expect(mockStore.init).toHaveBeenCalled();
    expect(mockWs.connect).toHaveBeenCalled();
  });

  it("shows a loader during initial loading", () => {
    mockStore.isInitialLoading = true;
    render(<MessengerView />);
    expect(screen.getByTestId("loader-lg")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-list")).not.toBeInTheDocument();
  });

  it("renders conversation list and chat view", () => {
    mockStore.conversations = [mockConversation()];
    render(<MessengerView />);
    expect(screen.getByTestId("conversation-list")).toBeInTheDocument();
    expect(screen.getByTestId("chat-view")).toBeInTheDocument();
  });

  it("syncs URL ?conversation param into the store on mount", async () => {
    mockSearchParams.set("conversation", "conv-1");
    render(<MessengerView />);
    await waitFor(() => {
      expect(mockStore.selectConversation).toHaveBeenCalledWith("conv-1");
    });
  });

  it("starts a chat from URL ?user param", async () => {
    mockSearchParams.set("user", "other-1");
    mockStore.createConversation.mockResolvedValue("conv-42");
    render(<MessengerView />);

    await waitFor(() => {
      expect(mockStore.createConversation).toHaveBeenCalledWith("other-1");
    });
    expect(mockStore.selectConversation).toHaveBeenCalledWith("conv-42");
    expect(mockSetSearchParams).toHaveBeenCalledWith(
      { conversation: "conv-42", user: "other-1" },
      { replace: true }
    );
  });

  it("subscribes to the selected conversation WS room and unsubscribes on change", async () => {
    const { rerender, unmount } = render(<MessengerView />);
    mockStore.selectedConversationId = "conv-1";
    rerender(<MessengerView />);

    await waitFor(() => {
      expect(mockEventManager.subscribeConversation).toHaveBeenCalledWith("conv-1");
    });

    mockStore.selectedConversationId = "conv-2";
    rerender(<MessengerView />);
    await waitFor(() => {
      expect(mockEventManager.unsubscribeConversation).toHaveBeenCalledWith("conv-1");
      expect(mockEventManager.subscribeConversation).toHaveBeenCalledWith("conv-2");
    });

    unmount();
    expect(mockWs.stopTyping).toHaveBeenCalledWith("conv-2");
  });

  it("passes typing username to ChatView", async () => {
    mockStore.conversations = [mockConversation({ other_user_id: "other-1" })];
    mockStore.selectedConversationId = "conv-1";
    mockStore.typingUsers = {
      "other-1": { user_id: "other-1", username: "alice", is_typing: true, timestamp: Date.now() },
    };
    render(<MessengerView />);
    await waitFor(() => {
      expect(screen.getByTestId("typing").textContent).toBe("alice");
    });
  });

  it("forwards typing events to the WS service", async () => {
    mockStore.selectedConversationId = "conv-1";
    render(<MessengerView />);
    fireEvent.click(screen.getByText("set-typing"));
    expect(mockWs.sendTyping).toHaveBeenCalledWith("conv-1", true);
  });

  it("goes back to the conversation list", async () => {
    mockStore.conversations = [mockConversation()];
    mockStore.selectedConversationId = "conv-1";
    render(<MessengerView />);
    fireEvent.click(screen.getByText("back"));

    await waitFor(() => {
      expect(mockStore.selectConversation).toHaveBeenCalledWith(null);
    });
    expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true });
  });

  it("selects a conversation from the list and updates the URL", async () => {
    mockStore.conversations = [mockConversation()];
    render(<MessengerView />);
    fireEvent.click(screen.getByText("select-conv"));

    await waitFor(() => {
      expect(mockStore.selectConversation).toHaveBeenCalledWith("conv-1");
    });
    expect(mockSetSearchParams).toHaveBeenCalledWith(
      { conversation: "conv-1", user: "other-1" },
      { replace: true }
    );
  });

  it("starts a chat from the list empty state", async () => {
    render(<MessengerView />);
    fireEvent.click(screen.getByText("start-chat"));

    await waitFor(() => {
      expect(mockStore.createConversation).toHaveBeenCalledWith("other-1");
      expect(mockStore.selectConversation).toHaveBeenCalledWith("conv-9");
    });
  });

  it("adds the messenger-mobile-chat-active body class when a chat is open on mobile", async () => {
    // Force mobile via matchMedia polyfill override
    (globalThis as any).__origMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width: 980px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    mockStore.conversations = [mockConversation()];
    mockStore.selectedConversationId = "conv-1";
    render(<MessengerView />);

    // Selecting a conversation closes the sidebar → showMobileChat becomes true
    fireEvent.click(screen.getByText("select-conv"));

    await waitFor(() => {
      expect(document.body.classList.contains("messenger-mobile-chat-active")).toBe(true);
    });
  });

  describe("sidebar resizer", () => {
    it("resizes the sidebar by dragging the resizer", () => {
      render(<MessengerView />);
      const resizer = screen.getByRole("separator", {
        name: "Изменить ширину списка диалогов",
      });

      fireEvent.mouseDown(resizer, { button: 0, clientX: 320 });
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);

      // Width = 320 + (400 - 320) = 400
      expect(localStorage.getItem("gomo6:messenger-sidebar-width")).toBe("400");
      expect(resizer).toHaveAttribute("aria-valuenow", "400");
    });

    it("collapses the sidebar when dragged past the collapse threshold", () => {
      render(<MessengerView />);
      const resizer = screen.getByRole("separator", {
        name: "Изменить ширину списка диалогов",
      });

      fireEvent.mouseDown(resizer, { button: 0, clientX: 320 });
      fireEvent.mouseMove(document, { clientX: 120 });
      fireEvent.mouseUp(document);

      // 320 + (120 - 320) = 120 ≤ 180 threshold → collapsed to 76
      expect(localStorage.getItem("gomo6:messenger-sidebar-width")).toBe("76");
      expect(resizer).toHaveAttribute("aria-valuenow", "76");
    });

    it("collapses and expands via keyboard arrows", () => {
      render(<MessengerView />);
      const resizer = screen.getByRole("separator", {
        name: "Изменить ширину списка диалогов",
      });

      // ArrowLeft → collapse
      fireEvent.keyDown(resizer, { key: "ArrowLeft" });
      expect(localStorage.getItem("gomo6:messenger-sidebar-width")).toBe("76");

      // ArrowRight while collapsed → expand to min width
      fireEvent.keyDown(resizer, { key: "ArrowRight" });
      expect(localStorage.getItem("gomo6:messenger-sidebar-width")).toBe("220");
    });

    it("restores a persisted sidebar width on mount", async () => {
      localStorage.setItem("gomo6:messenger-sidebar-width", "380");
      render(<MessengerView />);
      const resizer = await screen.findByRole("separator", {
        name: "Изменить ширину списка диалогов",
      });
      expect(resizer).toHaveAttribute("aria-valuenow", "380");
      localStorage.removeItem("gomo6:messenger-sidebar-width");
    });

    it("ignores non-primary mouse buttons", () => {
      render(<MessengerView />);
      const resizer = screen.getByRole("separator", {
        name: "Изменить ширину списка диалогов",
      });

      fireEvent.mouseDown(resizer, { button: 2, clientX: 320 });
      fireEvent.mouseMove(document, { clientX: 500 });
      fireEvent.mouseUp(document);

      expect(localStorage.getItem("gomo6:messenger-sidebar-width")).toBeNull();
    });
  });

  describe("initial loading edge cases", () => {
    it("shows empty chat panel when no conversation is selected", async () => {
      mockStore.conversations = [mockConversation()];
      render(<MessengerView />);
      expect(screen.getByTestId("chat-view")).toBeInTheDocument();
    });
  });
});
