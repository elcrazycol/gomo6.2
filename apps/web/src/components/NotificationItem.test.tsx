import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationItem } from "./NotificationItem";
import type { Notification } from "@/integrations/api/client";

vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: () => ({}),
}));

vi.mock("@/integrations/api/client", () => ({
  apiClient: {},
}));

vi.mock("@/services/websocket", () => ({
  wsService: {},
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>{children}</a>
  ),
}));

vi.mock("@/contexts/ProfileCacheContext", () => ({
  useProfileCache: () => ({
    loadProfile: vi.fn().mockResolvedValue({ username: "", avatarUrl: undefined }),
  }),
}));

vi.mock("@/components/NotificationThumb", () => ({
  NotificationThumb: () => null,
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: () => null,
}));

vi.mock("@/utils/safeDate", () => ({
  safeDate: (d: string) => new Date(d),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 часа назад",
}));

vi.mock("date-fns/locale", () => ({ ru: {} }));

const base: Notification = {
  id: "n1",
  user_id: "u1",
  type: "wall_post_like",
  title: "@alice оценил(а) 2 из ваших записей",
  message: "",
  related_user_id: "actor1",
  related_wall_post_id: "wp2",
  related_wall_user_id: "u1",
  is_read: false,
  group_count: 2,
  created_at: "2024-01-01T00:00:00Z",
};

describe("NotificationItem wall-like group footer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a 'show posts' footer when a wall-like burst has multiple posts", () => {
    render(
      <NotificationItem
        notification={{ ...base, related_wall_post_ids: ["wp1", "wp2"] }}
      />
    );

    const link = screen.getByText(/Показать 2 записи/);
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/notify/wall-likes/n1");
  });

  it("hides the footer for a single liked post", () => {
    render(
      <NotificationItem
        notification={{ ...base, related_wall_post_ids: ["wp1"], group_count: 1 }}
      />
    );

    expect(screen.queryByText(/Показать/)).not.toBeInTheDocument();
  });

  it("hides the footer for non-wall-like notifications", () => {
    render(
      <NotificationItem
        notification={{
          ...base,
          type: "reply",
          related_wall_post_ids: ["wp1", "wp2"],
        }}
      />
    );

    expect(screen.queryByText(/Показать/)).not.toBeInTheDocument();
  });
});
