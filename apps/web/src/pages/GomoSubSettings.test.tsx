import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import React from "react";

// ─── Mocks (mirror Board.test.tsx) ───────────────────────────────────

const { mockAuth, mockChain, mockToast } = vi.hoisted(() => {
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi.fn();
  return {
    mockAuth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() },
    mockChain: chain,
    mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({
  api: { from: (..._a: unknown[]) => mockChain, rpc: vi.fn(), auth: mockAuth },
}));
vi.mock("@/integrations/api/queryCache", () => ({ invalidateByPrefix: vi.fn() }));
vi.mock("@/services/websocket", () => ({
  wsService: { subscribe: vi.fn(), unsubscribe: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()) },
}));
vi.mock("sonner", () => ({ toast: mockToast }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ slug: "wiz" }),
    useLocation: () => ({ pathname: "/g/wiz/settings" }),
    useSearchParams: () => [new URLSearchParams(""), vi.fn()],
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
    Navigate: () => null,
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────

const board = {
  id: "b1", slug: "wiz", name: "Wiz", description: "d", rules_markdown: null,
  gomosub_avatar_url: null, cover_image_url: null, owner_id: "owner-1",
  gomosub_tags: [], is_gomosub: true, visibility: "public",
};
const channels = [{ id: "c1", board_id: "b1", name: "general", is_private: false, sort_order: 0, category_id: null }];
const roles = [
  { id: "r-every", board_id: "b1", name: "@everyone", color: "#99aab5", position: 0, permissions: { view_channel: true, send_messages: true }, is_everyone: true },
  { id: "r1", board_id: "b1", name: "mods", color: "#ff0000", position: 5, permissions: { can_manage_channels: true }, is_everyone: false },
];
const members = { members: [{ user_id: "owner-1", username: "owner", role_id: null, timed_out_until: null }] };
const grants: unknown[] = [];
const overwrites = [{ id: "ow1", channel_id: "c1", role_id: "r1", allow: {}, deny: {}, can_read: true, can_write: true }];

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) });
}
function rpc(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) });
}

function setupFetch() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/v1/channels?")) return json(channels);
    if (url.startsWith("/api/v1/channel_categories?")) return json([]);
    if (url.startsWith("/api/v1/gomosub_roles?")) return json(roles);
    if (url.startsWith("/api/rpc/gomosub_members?")) return rpc(members);
    if (url.startsWith("/api/v1/gomosub_member_roles?")) return json(grants);
    if (url.startsWith("/api/v1/channel_permissions?")) return json(overwrites);
    if (url.startsWith("/api/rpc/gomosub_bans?")) return rpc([]);
    if (url.startsWith("/api/rpc/get_board_user_permissions")) return json({ permissions: {} });
    if ((url.startsWith("/api/v1/channel_permissions") || url.startsWith("/api/v1/channels")) && init?.method && init.method !== "GET") {
      return rpc({});
    }
    return json([]);
  });
}

let SettingsPage: any;

// ─── Tests ────────────────────────────────────────────────────────────

describe("GomoSubSettings", () => {
  beforeAll(async () => {
    const mod = await import("./GomoSubSettings");
    SettingsPage = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: "tok", user: { id: "owner-1" } } }, error: null });
    mockChain.maybeSingle.mockResolvedValue({ data: board });
    mockChain.update.mockReturnValue({ ...mockChain, eq: vi.fn(() => ({ error: null })) });
    setupFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("loads the board and shows all settings tabs", async () => {
    render(<SettingsPage />);
    // Tabs render in both the mobile and desktop bars (CSS hides one).
    await waitFor(() => expect(screen.getAllByText("Роли").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Участники").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Каналы").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Баны").length).toBeGreaterThan(0);
    // General tab shows the board name in its form.
    expect(screen.getByDisplayValue("Wiz")).toBeInTheDocument();
    // Story posting lives here now (the board page shows only the avatar ring).
    expect(screen.getByText("Истории сообщества")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить историю" })).toBeInTheDocument();
  });

  it("opens channel overwrites and toggles a grant without collapsing", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getAllByText("Каналы").length).toBeGreaterThan(0));
    await user.click(screen.getAllByText("Каналы")[0]);

    // Channel row renders; open its access editor.
    await waitFor(() => expect(screen.getByText("general")).toBeInTheDocument());
    await user.click(screen.getByTitle("Права доступа"));

    // Overwrite rows load; flip view_channel to allow for the mods role.
    await waitFor(() => expect(screen.getByText(/Запрет побеждает/)).toBeInTheDocument());
    const allowButtons = screen.getAllByRole("radio");
    expect(allowButtons.length).toBeGreaterThan(0);
    await user.click(allowButtons[allowButtons.length - 1]);

    // The toggle issues a targeted PUT and the panel stays open.
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([u, init]) =>
        typeof u === "string" && u.startsWith("/api/v1/channel_permissions") && (init as RequestInit)?.method === "PUT",
      )).toBe(true);
    });
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.queryByText(/Запрет побеждает/)).toBeInTheDocument();
  });

  it("renders the roles tab with the @everyone base grants", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getAllByText("Роли").length).toBeGreaterThan(0));
    await user.click(screen.getAllByText("Роли")[0]);
    await waitFor(() => expect(screen.getByText("mods")).toBeInTheDocument());
    expect(screen.getByText("@everyone")).toBeInTheDocument();
  });
});
