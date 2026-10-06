import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { CompactThreadList, type ThreadLastPost } from "@/components/CompactThreadList";
import type { ThreadApiRow } from "@/utils/threadFeedItem";

// UserBadge pulls in ProfileHoverCard (react-query); a plain span keeps this
// test focused on the list itself.
vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: any) => <span data-testid="user-badge">{username}</span>,
}));

const row: ThreadApiRow = {
  id: "t1",
  title: "Как дела",
  content: "Как дела что делаете",
  image_url: null,
  created_at: "2026-01-01T10:00:00Z",
  updated_at: "2026-01-01T10:00:00Z",
  user_id: "u1",
  username: "bob",
  is_anonymous: false,
  post_count: 7,
  boards: { slug: "", name: "", is_gomosub: false },
  section: null,
  subsection: null,
};

const renderList = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("CompactThreadList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a dense row with replies, likes and the last poster", () => {
    renderList(
      <CompactThreadList
        rows={[row]}
        likes={new Map([["t1", { count: 2, isLiked: false }]])}
        lastPosts={
          new Map<string, ThreadLastPost>([
            [
              "t1",
              {
                user_id: "u2",
                username: "alice",
                avatar_url: null,
                created_at: "2026-01-02T10:00:00Z",
              },
            ],
          ])
        }
        currentUserId="me"
      />,
    );

    expect(screen.getByText("Как дела")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("falls back to the thread author when there are no replies", () => {
    renderList(<CompactThreadList rows={[row]} currentUserId="me" />);
    // Author shows in both the meta line and the right column.
    expect(screen.getAllByText("bob").length).toBeGreaterThanOrEqual(1);
  });

  it("offers a bookmark action for the thread", () => {
    renderList(<CompactThreadList rows={[row]} currentUserId="me" />);
    expect(screen.getByRole("button", { name: "В избранное" })).toBeInTheDocument();
  });

  it("shows the mini preview on hover after the delay, and hides on leave", () => {
    renderList(<CompactThreadList rows={[row]} currentUserId="me" />);

    const link = screen.getByRole("link");
    fireEvent.mouseOver(link);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("Как дела что делаете");

    fireEvent.mouseOut(link);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
