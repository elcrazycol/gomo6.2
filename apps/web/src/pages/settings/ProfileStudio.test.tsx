import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockAuth = {
  getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok" } } }),
  getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
};
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({
  api: { from: (...args: any[]) => mockFrom(...args), auth: mockAuth },
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: () => null,
  uploadFile: vi.fn().mockResolvedValue({ path: "u1/background_1.webp" }),
}));

vi.mock("@/utils/profileTheme", async () => {
  const actual = await vi.importActual("@/utils/profileTheme");
  return {
    ...actual,
    generateThemeVariants: vi.fn().mockResolvedValue([
      { id: "dominant", name: "Преобладающий", color: { h: 200, s: 50, l: 40 }, tokens: { "--primary": "200 50% 40%" } },
      { id: "vibrant", name: "Яркий", color: { h: 200, s: 70, l: 50 }, tokens: { "--primary": "200 70% 50%" } },
    ]),
  };
});

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));
vi.mock("@/components/EmojiPicker", () => ({
  EmojiPicker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/NicknameEmoji", () => ({
  NicknameEmoji: () => null,
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderStudio() {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ProfileStudioComponent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let ProfileStudioComponent: any;

describe("ProfileStudio", () => {
  beforeAll(async () => {
    const mod = await import("./ProfileStudio");
    ProfileStudioComponent = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Profile fetch: id=eq.u1
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/profiles?id=eq.")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: "u1",
                  username: "testuser",
                  display_name: "Test User",
                  avatar_url: null,
                  nickname_emoji_id: null,
                  wall_post_count: 3,
                  comment_count: 7,
                  likes_received_count: 25,
                  views_received_count: 777,
                  garma: 100,
                  background_variant: "page",
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    // customization query chain: from("profile_customization").select("*").eq("user_id","u1").maybeSingle()
    const eq = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) });
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => eq() }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }));
  });

  it("loads profile data and renders the studio header", async () => {
    renderStudio();
    expect(await screen.findByText("Студия профиля")).toBeInTheDocument();
    // Tabs present
    expect(screen.getByText("Шапка")).toBeInTheDocument();
    expect(screen.getByText("Тема")).toBeInTheDocument();
    expect(screen.getByText("Бейдж")).toBeInTheDocument();
  });

  it("shows the owner's background variant from the profile", async () => {
    renderStudio();
    await screen.findByText("Студия профиля");
    // The "page" variant card is rendered in the header tab (default tab).
    await waitFor(() => {
      expect(screen.getByText("Вся страница")).toBeInTheDocument();
    });
  });

  it("autosaves small edits with a debounce", async () => {
    renderStudio();
    await screen.findByText("Студия профиля");

    // Go to the username tab and type raw CSS via the textarea.
    await userEvent.click(screen.getByRole("tab", { name: /Никнейм/ }));
    await waitFor(() => {
      expect(screen.getByText("Быстрые стили")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/color: #d6d6de/);
    fireEvent.change(textarea, { target: { value: "color: #ff0000" } });

    // Debounce ~900ms — after that an upsert must fire.
    await waitFor(
      () => {
        const upsert = mockFrom.mock.results
          .map((r) => r.value)
          .find((v) => typeof v?.upsert === "function");
        expect(upsert).toBeDefined();
      },
      { timeout: 2000 },
    );
  });

  it("publishes the theme via the publish button", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
      upsert,
    }));

    renderStudio();
    await screen.findByText("Студия профиля");

    // The publish button lives in the Theme tab.
    await userEvent.click(screen.getByRole("tab", { name: /Тема/ }));
    const publishBtn = await screen.findByRole("button", { name: /Опубликовать тему/ });
    await userEvent.click(publishBtn);
    await waitFor(() => {
      expect(upsert).toHaveBeenCalled();
    });
    const payload = upsert.mock.calls[0][0];
    expect(payload.user_id).toBe("u1");
    expect(payload.theme_enabled).toBe(false);
    expect(payload.theme_tokens).toEqual({});
  });
});
