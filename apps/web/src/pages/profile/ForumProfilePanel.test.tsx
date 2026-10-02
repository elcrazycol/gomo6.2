import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Decouple the panel from the store-backed controls: this suite only checks
// which pieces the panel relocates, not how the controls behave.
vi.mock("@/components/FriendButton", () => ({
  FriendButton: ({ withLabel }: { withLabel?: boolean }) => (withLabel ? <button>Подписаться</button> : null),
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: () => <span data-testid="avatar" />,
}));
vi.mock("@/components/PostActionsMenu", () => ({
  PostActionsMenu: () => <button aria-label="Действия" />,
}));
vi.mock("@/components/SubscriptionsPanel", () => ({
  SubscriptionsPanel: () => <div data-testid="subscriptions-panel" />,
}));

import { ForumProfilePanel } from "./ForumProfilePanel";
import type { Profile } from "./types";

const profile = {
  id: "user-1",
  username: "forumguy",
  display_name: "Forum Guy",
  bio: null,
  is_anonymous: false,
  thread_count: 0,
  post_count: 0,
  wall_post_count: 0,
  comment_count: 0,
  likes_received_count: 0,
  views_received_count: 0,
  garma: 0,
  drops: 0,
  created_at: "2025-01-01T00:00:00Z",
} as Profile;

function renderPanel(overrides: Partial<React.ComponentProps<typeof ForumProfilePanel>> = {}) {
  return render(
    <ForumProfilePanel
      profile={profile}
      isOwnProfile={false}
      avatarVisible
      avatarUrl={null}
      currentUser={{ id: "viewer" }}
      canViewSubscriptions={false}
      onAvatarClick={vi.fn()}
      onOpenMessages={vi.fn()}
      onEditClick={vi.fn()}
      {...overrides}
    />
  );
}

describe("ForumProfilePanel", () => {
  it("moves the avatar and the write/subscribe actions into the panel", async () => {
    renderPanel();

    expect(screen.getByTestId("avatar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Написать" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подписаться" })).toBeInTheDocument();
    // The actions menu sits next to the subscribe button (forum-panel layout).
    expect(screen.getByRole("button", { name: "Действия" })).toBeInTheDocument();
  });

  it("shows an edit action instead of write/subscribe on the owner's own profile", () => {
    const onEditClick = vi.fn();
    renderPanel({ isOwnProfile: true, onEditClick });
    expect(screen.queryByRole("button", { name: "Написать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Подписаться" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    expect(onEditClick).toHaveBeenCalled();
  });

  it("hides the actions from guests but keeps the avatar", () => {
    renderPanel({ currentUser: null });
    expect(screen.getByTestId("avatar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Написать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Подписаться" })).not.toBeInTheDocument();
  });

  it("renders the social graph only when the viewer may see it", async () => {
    const { unmount } = renderPanel({ canViewSubscriptions: true });
    expect(await screen.findByTestId("subscriptions-panel")).toBeInTheDocument();
    unmount();

    renderPanel({ canViewSubscriptions: false });
    expect(screen.queryByTestId("subscriptions-panel")).not.toBeInTheDocument();
  });
});
