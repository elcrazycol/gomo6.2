import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationBell } from "./NotificationBell";

const mockInit = vi.fn();
const mockMarkAsRead = vi.fn();
const mockNavigateFn = vi.fn();
let notifications: any[] = [];
let unreadCount = 0;

vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (selector: any) => {
    const state = { notifications, unreadCount, init: mockInit, markAsRead: mockMarkAsRead };
    return selector(state);
  },
}));

vi.mock("@/integrations/api/client", () => ({
  apiClient: {},
}));

vi.mock("@/services/websocket", () => ({
  wsService: {},
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigateFn,
  Link: ({ children, to, className, onMouseEnter }: any) => (
    <a href={to} className={className} onMouseEnter={onMouseEnter}>{children}</a>
  ),
}));

vi.mock("@/utils/safeDate", () => ({
  safeDate: (d: string) => new Date(d),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 часа назад",
}));

vi.mock("date-fns/locale", () => ({ ru: {} }));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifications = [];
    unreadCount = 0;
  });

  it("renders bell icon", () => {
    render(<NotificationBell userId="user-1" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("calls init on mount", () => {
    render(<NotificationBell userId="user-1" />);
    expect(mockInit).toHaveBeenCalledWith("user-1");
  });

  it("shows unread badge", () => {
    unreadCount = 3;
    render(<NotificationBell userId="user-1" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows 99+ for counts over 99", () => {
    unreadCount = 150;
    render(<NotificationBell userId="user-1" />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("does not show badge when count is 0", () => {
    unreadCount = 0;
    render(<NotificationBell userId="user-1" />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("navigates to /notify on click", async () => {
    render(<NotificationBell userId="user-1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockNavigateFn).toHaveBeenCalledWith("/notify");
  });

  it("shows card on mouse enter", async () => {
    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("Уведомления")).toBeInTheDocument();
    });
  });

  it("shows 'Нет уведомлений' when empty", async () => {
    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("Нет уведомлений")).toBeInTheDocument();
    });
  });

  it("shows notifications when loaded", async () => {
    notifications = [
      { id: "n1", title: "New like", message: "User liked your post", is_read: false, created_at: "2025-01-01T00:00:00Z", related_thread_id: "t1" },
      { id: "n2", title: "New comment", message: "User commented", is_read: true, created_at: "2025-01-01T00:00:00Z", related_thread_id: null },
    ];

    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("New like")).toBeInTheDocument();
      expect(screen.getByText("New comment")).toBeInTheDocument();
    });
  });

  it("shows 'Все →' link", async () => {
    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("Все →")).toBeInTheDocument();
    });
  });

  it("marks notification as read on hover", async () => {
    notifications = [
      { id: "n1", title: "New like", message: "User liked", is_read: false, created_at: "2025-01-01T00:00:00Z", related_thread_id: "t1" },
    ];

    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("New like")).toBeInTheDocument();
    });

    const notifLink = screen.getByText("New like").closest("a")!;
    fireEvent.mouseEnter(notifLink);

    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith("n1");
    });
  });

  it("does not mark already-read notifications", async () => {
    notifications = [
      { id: "n1", title: "Old notif", message: "Already read", is_read: true, created_at: "2025-01-01T00:00:00Z", related_thread_id: null },
    ];

    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Old notif")).toBeInTheDocument();
    });

    const notifLink = screen.getByText("Old notif").closest("a")!;
    fireEvent.mouseEnter(notifLink);

    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });
});
