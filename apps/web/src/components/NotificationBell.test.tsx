import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationBell } from "./NotificationBell";

const mockGetUnreadNotificationsCount = vi.fn();
const mockGetNotifications = vi.fn();
const mockMarkNotificationAsRead = vi.fn();
const mockSubscribeToNotifications = vi.fn();
const mockOn = vi.fn(() => vi.fn());
const mockNavigateFn = vi.fn();

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    getUnreadNotificationsCount: (...args: any[]) => mockGetUnreadNotificationsCount(...args),
    getNotifications: (...args: any[]) => mockGetNotifications(...args),
    markNotificationAsRead: (...args: any[]) => mockMarkNotificationAsRead(...args),
  },
}));

vi.mock("@/services/websocket", () => ({
  wsService: {
    subscribeToNotifications: (...args: any[]) => mockSubscribeToNotifications(...args),
    on: (...args: any[]) => mockOn(...args),
    connected: true,
  },
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetUnreadNotificationsCount.mockResolvedValue({ data: { unread_count: 3 }, error: null });
    mockGetNotifications.mockResolvedValue({ data: [], error: null });
    mockOn.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders bell icon", () => {
    render(<NotificationBell userId="user-1" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("loads unread count on mount", async () => {
    render(<NotificationBell userId="user-1" />);
    await waitFor(() => {
      expect(mockGetUnreadNotificationsCount).toHaveBeenCalled();
    });
  });

  it("shows unread badge", async () => {
    render(<NotificationBell userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("shows 99+ for counts over 99", async () => {
    mockGetUnreadNotificationsCount.mockResolvedValue({ data: { unread_count: 150 }, error: null });
    render(<NotificationBell userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("99+")).toBeInTheDocument();
    });
  });

  it("does not show badge when count is 0", async () => {
    mockGetUnreadNotificationsCount.mockResolvedValue({ data: { unread_count: 0 }, error: null });
    render(<NotificationBell userId="user-1" />);
    await waitFor(() => {
      expect(mockGetUnreadNotificationsCount).toHaveBeenCalled();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("subscribes to notifications on mount", async () => {
    render(<NotificationBell userId="user-1" />);
    expect(mockSubscribeToNotifications).toHaveBeenCalledWith("user-1");
  });

  it("registers websocket listener", async () => {
    render(<NotificationBell userId="user-1" />);
    expect(mockOn).toHaveBeenCalledWith("new_notification", expect.any(Function));
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
    mockGetNotifications.mockResolvedValue({
      data: [
        { id: "n1", title: "New like", message: "User liked your post", is_read: false, created_at: "2025-01-01T00:00:00Z", related_thread_id: "t1" },
        { id: "n2", title: "New comment", message: "User commented", is_read: true, created_at: "2025-01-01T00:00:00Z", related_thread_id: null },
      ],
      error: null,
    });

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
    mockGetNotifications.mockResolvedValue({
      data: [
        { id: "n1", title: "New like", message: "User liked", is_read: false, created_at: "2025-01-01T00:00:00Z", related_thread_id: "t1" },
      ],
      error: null,
    });

    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("New like")).toBeInTheDocument();
    });

    const notifLink = screen.getByText("New like").closest("a")!;
    fireEvent.mouseEnter(notifLink);

    await waitFor(() => {
      expect(mockMarkNotificationAsRead).toHaveBeenCalledWith("n1");
    });
  });

  it("does not mark already-read notifications", async () => {
    mockGetNotifications.mockResolvedValue({
      data: [
        { id: "n1", title: "Old notif", message: "Already read", is_read: true, created_at: "2025-01-01T00:00:00Z", related_thread_id: null },
      ],
      error: null,
    });

    render(<NotificationBell userId="user-1" />);
    fireEvent.mouseEnter(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Old notif")).toBeInTheDocument();
    });

    const notifLink = screen.getByText("Old notif").closest("a")!;
    fireEvent.mouseEnter(notifLink);

    expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
  });
});
