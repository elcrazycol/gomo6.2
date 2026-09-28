import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Settings from "./Settings";

vi.mock("@/integrations/api/compat", () => ({
  api: { auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) } },
}));

// The sections have their own tests — this one is about the shell: which layout
// the window gets and which section the URL selects.
vi.mock("@/components/settings/AppearanceSection", () => ({ AppearanceSection: () => <div>APPEARANCE</div> }));
vi.mock("@/components/settings/PrivacySection", () => ({ PrivacySection: () => <div>PRIVACY</div> }));
vi.mock("@/components/settings/SecuritySection", () => ({ SecuritySection: () => <div>SECURITY</div> }));
vi.mock("@/components/settings/ProfileSection", () => ({ ProfileSection: () => <div>PROFILE</div> }));
vi.mock("@/components/settings/IntegrationsSection", () => ({ IntegrationsSection: () => <div>INTEGRATIONS</div> }));
vi.mock("@/components/settings/LivePreview", () => ({ LivePreview: () => <div>LIVE-PREVIEW</div> }));
vi.mock("@/components/NotificationsSettings", () => ({ default: () => <div>NOTIFICATIONS</div> }));
vi.mock("@/components/settings/useAppearanceSettings", () => ({
  useAppearanceSettings: () => ({ publishStyle: "gradient-pill", headerBehavior: "fixed" }),
}));

const setWidth = (width: number) =>
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(1200);
});

describe("Settings shell", () => {
  it("renders the sidebar with every section on a desktop window", async () => {
    renderAt("/settings/privacy");

    await waitFor(() => {
      expect(screen.getByText("PRIVACY")).toBeInTheDocument();
    });

    for (const label of ["Профиль", "Внешний вид", "Уведомления", "Приватность", "Безопасность", "Интеграции"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("routes the URL section to its component", async () => {
    const { unmount } = renderAt("/settings/security");
    await waitFor(() => expect(screen.getByText("SECURITY")).toBeInTheDocument());
    unmount();

    renderAt("/settings/notifications");
    await waitFor(() => expect(screen.getByText("NOTIFICATIONS")).toBeInTheDocument());
  });

  it("redirects to Внешний вид when no section is given", async () => {
    renderAt("/settings");
    await waitFor(() => expect(screen.getByText("APPEARANCE")).toBeInTheDocument());
  });

  it("redirects unknown or legacy section names instead of showing a stub", async () => {
    renderAt("/settings/bogus");
    await waitFor(() => expect(screen.getByText("APPEARANCE")).toBeInTheDocument());
  });

  it("shows the hub — not the sidebar — on a narrow window", async () => {
    setWidth(600);
    renderAt("/settings");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Приватность/ })).toBeInTheDocument();
    });
    // The hub lists sections with their descriptions, it does not open one.
    expect(screen.queryByText("PRIVACY")).not.toBeInTheDocument();
    expect(screen.getByText("Кто видит ваш профиль и данные")).toBeInTheDocument();
  });

  it("drills into a section on a narrow window with a back link", async () => {
    setWidth(600);
    renderAt("/settings/privacy");

    await waitFor(() => {
      expect(screen.getByText("PRIVACY")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Назад/ })).toBeInTheDocument();
  });

  it("adds the live preview column on a wide window", async () => {
    setWidth(1400);
    renderAt("/settings/appearance");

    await waitFor(() => {
      expect(screen.getByText("LIVE-PREVIEW")).toBeInTheDocument();
    });
  });
});
