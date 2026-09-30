import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import Appeals from "./Appeals";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

const { mockRawRequest } = vi.hoisted(() => ({ mockRawRequest: vi.fn() }));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

const sanction = {
  id: "s-1",
  kind: "mute",
  reason: "флуд в комментариях",
  created_at: "2026-09-30T10:00:00Z",
  expires_at: null,
  active: true,
};

const apiResponse = (data: unknown) => ({ success: true, data });

describe("Appeals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRawRequest.mockImplementation((url: string) => {
      if (url.includes("/sanctions/mine")) return Promise.resolve(apiResponse({ items: [sanction] }));
      if (url.includes("/appeals/mine")) return Promise.resolve(apiResponse({ items: [] }));
      return Promise.resolve(apiResponse({ id: "ap-1" }));
    });
  });

  it("lists active sanctions with an appeal action", async () => {
    render(<Appeals />);
    await waitFor(() => {
      expect(screen.getByText("Запрет писать")).toBeInTheDocument();
    });
    expect(screen.getByText("флуд в комментариях")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обжаловать" })).toBeInTheDocument();
  });

  it("submits an appeal for the chosen sanction", async () => {
    render(<Appeals />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Обжаловать" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Обжаловать" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByPlaceholderText(/Объясните/), "это была не реклама, а ссылка на источник");
    await userEvent.click(within(dialog).getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith("/api/v1/moderation/appeals", {
        method: "POST",
        body: JSON.stringify({ sanction_id: "s-1", body: "это была не реклама, а ссылка на источник" }),
      });
      expect(toast.success).toHaveBeenCalledWith("Апелляция отправлена");
    });
  });

  it("marks a sanction whose appeal is already filed", async () => {
    mockRawRequest.mockImplementation((url: string) => {
      if (url.includes("/sanctions/mine")) return Promise.resolve(apiResponse({ items: [sanction] }));
      if (url.includes("/appeals/mine")) {
        return Promise.resolve(apiResponse({ items: [{ id: "ap-1", sanction_id: "s-1", sanction_kind: "mute", sanction_reason: "флуд", body: "x", status: "open" }] }));
      }
      return Promise.resolve(apiResponse({}));
    });

    render(<Appeals />);
    await waitFor(() => {
      expect(screen.getByText("апелляция подана")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Обжаловать" })).not.toBeInTheDocument();
  });
});
