import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import Notify from "@/pages/Notify";

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    notifications: [] as Array<Record<string, unknown>>,
    unreadCount: 0,
    hasMore: false,
    isLoadingMore: false,
    fetchMore: vi.fn(),
    resetAndFetch: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  },
}));

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    getCurrentUser: vi.fn().mockResolvedValue({ id: "u1" }),
    request: vi.fn().mockResolvedValue({ data: [] }),
  },
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));
vi.mock("@/components/NotificationItem", () => ({
  NotificationItem: ({ notification }: { notification: { id: string } }) => (
    <div data-testid="notif-row">{notification.id}</div>
  ),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const observed: Array<{ el: Element; cb: IntersectionObserverCallback }> = [];

class MockIntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    observed.push({ el, cb: this.cb });
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

describe("Notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observed.length = 0;
    mockStore.hasMore = false;
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    mockStore.notifications = [
      { id: "n1", is_read: false, type: "like", created_at: new Date().toISOString() },
    ];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("groups by day and marks an item read once it has been on screen", async () => {
    render(<Notify />);

    await waitFor(() => expect(screen.getByTestId("notif-row")).toBeInTheDocument());
    expect(screen.getByText("Сегодня")).toBeInTheDocument();

    // Pick the row's own observer (the sentinel carries a testid).
    await waitFor(() =>
      expect(observed.some((o) => (o.el as HTMLElement).dataset.testid !== "notify-sentinel")).toBe(true),
    );
    const rowObserver = observed.filter(
      (o) => (o.el as HTMLElement).dataset.testid !== "notify-sentinel",
    ).pop()!;
    act(() => {
      rowObserver.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    // The row must be visible for ~a second before it counts as read.
    await waitFor(() => expect(mockStore.markAsRead).toHaveBeenCalledWith("n1"), { timeout: 2500 });
  });

  it("loads the next page when the sentinel comes into view", async () => {
    mockStore.hasMore = true;
    render(<Notify />);
    await waitFor(() => expect(screen.getByTestId("notif-row")).toBeInTheDocument());

    await waitFor(() =>
      expect(
        observed.some((o) => (o.el as HTMLElement).dataset.testid === "notify-sentinel"),
      ).toBe(true),
    );
    const sentinel = observed.find(
      (o) => (o.el as HTMLElement).dataset.testid === "notify-sentinel",
    )!;

    act(() => {
      sentinel.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(mockStore.fetchMore).toHaveBeenCalled();
  });
});
