import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { GomoSubChannelsList } from "./GomoSubChannelsList";

vi.mock("@/lib/routeChunks", () => ({ prefetchRouteChunk: vi.fn() }));
vi.mock("@/lib/routeData", () => ({ prefetchRouteData: vi.fn(), shouldPrefetch: () => false }));
// AnimatePresence exits never settle in jsdom (no compositor frames); the
// passthrough unmounts collapsed rows synchronously, like AppLayout.test.
vi.mock("motion/react", async () => {
  const actual = await vi.importActual("motion/react");
  return { ...actual, AnimatePresence: ({ children }: any) => <>{children}</> };
});

const groups = [
  {
    category: "Инфо",
    channels: [
      { id: "c1", slug: "rules", name: "правила", is_private: false },
      { id: "c2", slug: "news", name: "новости", is_private: false },
    ],
  },
  {
    category: "Текстовые",
    channels: [{ id: "c3", slug: "chat", name: "общение", is_private: false, kind: "text" as const }],
  },
];

const renderList = (props?: Partial<React.ComponentProps<typeof GomoSubChannelsList>>) =>
  render(
    <MemoryRouter>
      <GomoSubChannelsList boardSlug="wiz" groups={groups} activeChannelSlug="rules" {...props} />
    </MemoryRouter>,
  );

describe("GomoSubChannelsList collapse", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("collapses a section on header click and persists it", async () => {
    const user = userEvent.setup();
    renderList();

    expect(screen.getByRole("link", { name: "новости" })).toBeInTheDocument();
    const header = screen.getByRole("button", { name: /Инфо/ });
    expect(header).toHaveAttribute("aria-expanded", "true");

    await user.click(header);
    expect(screen.queryByRole("link", { name: "новости" })).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse(localStorage.getItem("gomosub-collapsed:wiz") ?? "[]")).toEqual(["Инфо"]);

    await user.click(header);
    expect(screen.getByRole("link", { name: "новости" })).toBeInTheDocument();
  });

  it("restores collapsed sections and forces them open while searching", async () => {
    localStorage.setItem("gomosub-collapsed:wiz", JSON.stringify(["Инфо"]));
    const { rerender } = render(
      <MemoryRouter>
        <GomoSubChannelsList boardSlug="wiz" groups={groups} activeChannelSlug="chat" />
      </MemoryRouter>,
    );

    // "правила" hidden (collapsed), but the active channel's group opens.
    expect(screen.queryByRole("link", { name: "правила" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "общение" })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <GomoSubChannelsList boardSlug="wiz" groups={groups} activeChannelSlug="chat" query="прав" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "правила" })).toBeInTheDocument();
  });

  it("shows an unread dot on a collapsed section with unseen activity", () => {
    localStorage.setItem("gomosub-collapsed:wiz", JSON.stringify(["Текстовые"]));
    renderList({ activeChannelSlug: "rules", unread: new Set(["c3"]) });

    const header = screen.getByRole("button", { name: /Текстовые/ });
    expect(within(header).getByLabelText("Есть новое")).toBeInTheDocument();
  });
});
