import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: () => <span data-testid="avatar" />,
}));
vi.mock("@/components/OnlineStatus", () => ({ OnlineStatus: () => null }));
vi.mock("@/components/NicknameEmoji", () => ({ NicknameEmoji: () => null }));
vi.mock("@/hooks/useRealtimeStatus", () => ({
  useRealtimeOnlineStatus: () => new Map(),
}));

const subscribers = Array.from({ length: 7 }, (_, i) => ({
  user_id: `u-${i}`,
  username: `user${i}`,
  display_name: `User ${i}`,
  is_online: false,
  is_friend: false,
  subscribed_at: "2025-01-01T00:00:00Z",
}));

vi.mock("@/stores/friendsStore", () => ({
  useFriendsStore: (selector: (s: unknown) => unknown) =>
    selector({ profileSubscribers: subscribers, profileSubscriptions: [] }),
}));

import { SubscriptionList } from "./SubscriptionList";

describe("SubscriptionList", () => {
  it("caps the rendered rows at the limit and shows how many are hidden", () => {
    render(<SubscriptionList kind="subscribers" limit={5} />);

    expect(screen.getByText("User 0")).toBeInTheDocument();
    expect(screen.getByText("User 4")).toBeInTheDocument();
    expect(screen.queryByText("User 5")).not.toBeInTheDocument();
    expect(screen.getByText("и ещё 2")).toBeInTheDocument();
  });

  it("renders the full list when no limit is given", () => {
    render(<SubscriptionList kind="subscribers" />);

    expect(screen.getByText("User 6")).toBeInTheDocument();
    expect(screen.queryByText(/и ещё/)).not.toBeInTheDocument();
  });
});
