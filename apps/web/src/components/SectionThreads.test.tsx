import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { SectionThreads } from "@/components/SectionThreads";
import type { SectionWithSubsections } from "@/hooks/useThreadSections";

vi.mock("@/components/FeedThreadCard", () => ({
  FeedThreadCard: ({ thread, initialLikesCount }: any) => (
    <div data-testid="thread-card" data-likes={initialLikesCount}>
      {thread.title}
    </div>
  ),
}));

vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("@/components/PentagramLoader", () => ({ PentagramLoader: () => <span /> }));
vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: any) => <span data-testid="user-badge">{username}</span>,
}));
vi.mock("@/components/skeletons/ContentSkeletons", () => ({
  ThreadFeedSkeleton: () => <div data-testid="skeleton" />,
}));

const section: SectionWithSubsections = {
  id: "s1",
  slug: "games",
  name: "Игры",
  description: null,
  icon: "gamepad-2",
  is_nsfw: false,
  sort_order: 30,
  subsections: [],
};

const thread = {
  id: "t1",
  title: "Тема раздела",
  content: "текст",
  created_at: "2026-01-01T10:00:00Z",
  updated_at: "2026-01-01T10:00:00Z",
  user_id: "u1",
  username: "bob",
  is_anonymous: false,
};

const mockFetch = (threads: unknown[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("/api/v1/threads") ? { data: threads } : { data: [] },
    })),
  );
};

const renderSection = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("SectionThreads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders the section header and its threads in the compact list by default", async () => {
    mockFetch([thread]);

    renderSection(<SectionThreads section={section} currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByText("Тема раздела")).toBeInTheDocument());
    expect(screen.getByText("Игры")).toBeInTheDocument();
    // Compact view — the card renderer is not used until the toggle flips.
    expect(screen.queryByTestId("thread-card")).not.toBeInTheDocument();
  });

  it("switches to the card feed via the view toggle and remembers the choice", async () => {
    mockFetch([thread]);

    renderSection(<SectionThreads section={section} currentUserId="me" currentUsername="me" />);
    await waitFor(() => expect(screen.getByText("Тема раздела")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Лента" }));

    await waitFor(() => expect(screen.getByTestId("thread-card")).toHaveTextContent("Тема раздела"));
    expect(localStorage.getItem("gomo6:section-view")).toBe("cards");
  });

  it("shows the empty state when the section has no threads", async () => {
    mockFetch([]);

    renderSection(
      <SectionThreads
        section={{ ...section, id: "s2", slug: "empty", name: "Пусто" }}
        currentUserId={null}
        currentUsername=""
      />,
    );

    await waitFor(() => expect(screen.getByText("Здесь пока пусто")).toBeInTheDocument());
  });

  it("filters the request by section_id and subsection_id", async () => {
    mockFetch([]);

    renderSection(
      <SectionThreads
        section={section}
        subsection={{ id: "sub1", section_id: "s1", slug: "pc", name: "ПК", description: null, sort_order: 10 }}
        currentUserId="me"
        currentUsername="me"
      />,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const calledUrl = String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]);
    expect(calledUrl).toContain("section_id=eq.s1");
    expect(calledUrl).toContain("subsection_id=eq.sub1");
  });
});
