import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { MrRandom } from "@/components/MrRandom";

const requestMock = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: (...args: any[]) => requestMock(...args) },
}));

vi.mock("@/components/PrefetchLink", () => ({
  PrefetchLink: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const items = [
  { type: "thread", id: "t1", label: "Тема", sublabel: "тема" },
  { type: "thread", id: "t2", label: "g-тема", sublabel: "g/tech", is_gomosub: true, board_slug: "tech" },
  { type: "wall_post", id: "w1", label: "Пост", sublabel: "@bob", wall_user_id: "u1" },
  { type: "wall_comment", id: "c1", label: "Коммент", sublabel: "@bob", wall_user_id: "u1", post_id: "w1" },
  { type: "profile", id: "u2", label: "alice", sublabel: "профиль" },
  { type: "gomosub", id: "b1", label: "g/test", sublabel: "тест", board_slug: "test" },
];

describe("MrRandom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading and links each item to its route", async () => {
    requestMock.mockResolvedValue({ data: items });

    render(<MrRandom />);

    await waitFor(() => expect(screen.getByText("Тема")).toBeInTheDocument());
    expect(screen.getByText("Mr. рандомность")).toBeInTheDocument();

    const href = (label: string) => screen.getByText(label).closest("a")?.getAttribute("href");
    expect(href("Тема")).toBe("/thread/t1");
    expect(href("g-тема")).toBe("/g/tech/thread/t2");
    expect(href("Пост")).toBe("/profile/u1/wall/w1");
    expect(href("Коммент")).toBe("/profile/u1/wall/w1");
    expect(href("alice")).toBe("/profile/u2");
    expect(href("g/test")).toBe("/g/test");
  });

  it("shows the empty state when there is nothing to show", async () => {
    requestMock.mockResolvedValue({ data: [] });

    render(<MrRandom />);

    await waitFor(() => expect(screen.getByText("Пока нечего показать")).toBeInTheDocument());
  });
});
