import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { MobileMenu } from "@/components/MobileMenu";

vi.mock("@/integrations/api/compat", () => {
  // A chainable PostgREST-ish stub so the profile/subscription loads settle.
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "insert", "update", "delete"].forEach(
    (method) => {
      chain[method] = self;
    },
  );
  chain.then = (cb: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(cb);
  return { api: { from: vi.fn(() => chain), auth: { signOut: vi.fn() } } };
});
vi.mock("@/hooks/useThreadSections", () => ({
  useThreadSections: () => ({ sections: [], loading: false, error: null, reload: vi.fn() }),
}));
vi.mock("@/stores/sidebarTabsStore", () => ({
  useSidebarTabsStore: (selector: (s: unknown) => unknown) =>
    selector({ tabs: [], loaded: true, removeTab: vi.fn() }),
}));
vi.mock("@/components/MrRandom", () => ({ MrRandom: () => null }));
vi.mock("@/components/AddTabDialog", () => ({ AddTabDialog: () => null }));
vi.mock("@/components/HeaderUsername", () => ({ HeaderUsername: () => null }));
vi.mock("@/components/topic/sectionIcons", () => ({ SectionIcon: () => null }));

type MenuUser = React.ComponentProps<typeof MobileMenu>["user"];

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderMenu = (user: MenuUser) =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MobileMenu user={user} isModerator={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("MobileMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the hamburger for guests and a login CTA inside the menu", async () => {
    renderMenu(null);

    const trigger = screen.getByTestId("mobile-menu-trigger");
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText("Создать тему")).toBeInTheDocument());
    expect(screen.getByText("Войдите, чтобы увидеть профиль")).toBeInTheDocument();
    expect(screen.queryByText("Войти")).not.toBeInTheDocument();
  });

  it("shows the account panel instead of the login CTA for a logged-in user", async () => {
    renderMenu({ id: "user-1" } as MenuUser);

    fireEvent.click(screen.getByTestId("mobile-menu-trigger"));

    await waitFor(() => expect(screen.getByText("Создать тему")).toBeInTheDocument());
    expect(screen.queryByText("Войдите, чтобы увидеть профиль")).not.toBeInTheDocument();
  });
});
