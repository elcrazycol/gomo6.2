import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { IntegrationsSection } from "./IntegrationsSection";

const mockGetSession = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let fetchMock: ReturnType<typeof vi.fn>;

const renderSection = (url = "/settings/integrations") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <IntegrationsSection userId="u1" />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  fetchMock = vi.fn(async () => jsonResponse({ connected: false }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntegrationsSection", () => {
  it("shows the connect action when Spotify is not linked", async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Подключить Spotify/ })).toBeInTheDocument();
    });
    expect(screen.getByText("Другие сервисы")).toBeInTheDocument();
  });

  it("shows the account and a disconnect action when linked", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ connected: true, spotify_name: "Listener", spotify_avatar: "https://cdn.example/a.png" }),
    );
    renderSection();

    await waitFor(() => {
      expect(screen.getByText("Подключён как Listener")).toBeInTheDocument();
    });
    expect(screen.getByText("Listener")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await userEvent.click(screen.getByRole("button", { name: /Отключить Spotify/ }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Spotify отключён");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/integrations/spotify/disconnect",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("explains when the server has no Spotify credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ connected: false })); // status
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "spotify integration is not configured" }, false)); // auth-url

    renderSection();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Подключить Spotify/ })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Подключить Spotify/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("spotify integration is not configured");
    });
  });

  it("surfaces an OAuth error handed back in the URL", async () => {
    renderSection("/settings/integrations?spotify_status=error&spotify_message=Access+denied");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Access denied");
    });
  });
});
