import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import { PostActionsMenu } from "./PostActionsMenu";
import { resetReportedPosts } from "./moderation/reportState";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockRawRequest = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { rawRequest: (...args: any[]) => mockRawRequest(...args) },
}));

describe("PostActionsMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReportedPosts();
  });

  it("renders the three-dots trigger", () => {
    render(<PostActionsMenu postId="post-1" />);
    expect(screen.getByTitle("Меню поста")).toBeInTheDocument();
  });

  it("shows the report item and opens the report dialog when a postId is given", async () => {
    render(<PostActionsMenu postId="post-1" />);
    await userEvent.click(screen.getByTitle("Меню поста"));
    await waitFor(() => {
      expect(screen.getByTitle("Пожаловаться")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTitle("Пожаловаться"));
    await waitFor(() => {
      expect(screen.getByText("Пожаловаться на запись")).toBeInTheDocument();
    });
  });

  it("renders caller-provided items above the report item", async () => {
    render(
      <PostActionsMenu postId="post-1">
        <button type="button" title="Редактировать">
          Edit
        </button>
      </PostActionsMenu>,
    );
    await userEvent.click(screen.getByTitle("Меню поста"));
    await waitFor(() => {
      expect(screen.getByTitle("Редактировать")).toBeInTheDocument();
      expect(screen.getByTitle("Пожаловаться")).toBeInTheDocument();
    });
  });

  it("does not render a report item without a postId (threads)", async () => {
    render(<PostActionsMenu />);
    await userEvent.click(screen.getByTitle("Меню поста"));
    await waitFor(() => {
      expect(screen.getByTitle("Меню поста")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Пожаловаться")).not.toBeInTheDocument();
  });
});

describe("ReportDialog (via menu)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the submit button disabled until the reason is long enough", async () => {
    render(<PostActionsMenu postId="post-1" />);
    await userEvent.click(screen.getByTitle("Меню поста"));
    await userEvent.click(await screen.findByTitle("Пожаловаться"));

    const submit = await screen.findByRole("button", { name: "Отправить жалобу" });
    expect(submit).toBeDisabled();

    const textarea = screen.getByPlaceholderText("Опишите проблему подробнее…");
    await userEvent.type(textarea, "short");
    expect(submit).toBeDisabled();

    await userEvent.type(textarea, " this reason is long enough");
    expect(submit).toBeEnabled();
  });

  it("submits the report with category and reason", async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: {} });
    render(<PostActionsMenu postId="post-submit" />);
    await userEvent.click(screen.getByTitle("Меню поста"));
    await userEvent.click(await screen.findByTitle("Пожаловаться"));

    await userEvent.click(screen.getByRole("button", { name: "Мошенничество" }));
    await userEvent.type(
      screen.getByPlaceholderText("Опишите проблему подробнее…"),
      "Этот пост выглядит как мошенническая схема с вкладами",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Отправить жалобу" }));

    await waitFor(() => {
      expect(mockRawRequest).toHaveBeenCalledWith(
        "/api/v1/moderation/reports",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            post_id: "post-submit",
            category: "fraud",
            reason: "Этот пост выглядит как мошенническая схема с вкладами",
          }),
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("Жалоба отправлена. Спасибо!");
    });
  });

  it("shows a friendly toast when the user already reported this post", async () => {
    mockRawRequest.mockRejectedValue({ code: "report_already_exists" });
    render(<PostActionsMenu postId="post-dup" />);
    await userEvent.click(screen.getByTitle("Меню поста"));
    await userEvent.click(await screen.findByTitle("Пожаловаться"));

    await userEvent.type(
      screen.getByPlaceholderText("Опишите проблему подробнее…"),
      "Эта жалоба должна вернуть ошибку дубликата",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Отправить жалобу" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Вы уже пожаловались на эту запись");
    });
  });

  it("blocks a second report in the same session (menu shows the already-reported state)", async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: {} });
    render(<PostActionsMenu postId="post-session" />);
    await userEvent.click(screen.getByTitle("Меню поста"));
    await userEvent.click(await screen.findByTitle("Пожаловаться"));

    await userEvent.type(
      screen.getByPlaceholderText("Опишите проблему подробнее…"),
      "Первая жалоба уходит успешно",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Отправить жалобу" }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Жалоба отправлена. Спасибо!");
    });

    // Reopen the menu — the report item must be gone, replaced by the disabled state.
    await userEvent.click(screen.getByTitle("Меню поста"));
    await waitFor(() => {
      expect(screen.queryByTitle("Пожаловаться")).not.toBeInTheDocument();
      expect(screen.getByTitle("Вы уже пожаловались на эту запись")).toBeInTheDocument();
    });
  });
});