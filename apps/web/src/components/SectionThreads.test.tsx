import { render, screen, waitFor } from "@testing-library/react";
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

describe("SectionThreads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the section header and its threads", async () => {
    mockFetch([
      {
        id: "t1",
        title: "Тема раздела",
        content: "текст",
        created_at: "2026-01-01T10:00:00Z",
        updated_at: "2026-01-01T10:00:00Z",
        user_id: "u1",
        username: "bob",
        is_anonymous: false,
      },
    ]);

    render(<SectionThreads section={section} currentUserId="me" currentUsername="me" />);

    await waitFor(() => expect(screen.getByTestId("thread-card")).toHaveTextContent("Тема раздела"));
    expect(screen.getByText("Игры")).toBeInTheDocument();
  });

  it("shows the empty state when the section has no threads", async () => {
    mockFetch([]);

    render(
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

    render(
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
