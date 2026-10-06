import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast } from "sonner";

import { PostActionsMenu } from "./PostActionsMenu";
import { resetReportedTargets } from "./moderation/reportState";

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
    resetReportedTargets();
  });

  it("renders the three-dots trigger", () => {
    render(<PostActionsMenu targetType="wall_post" targetId="post-1" />);
    expect(screen.getByTitle("Меню")).toBeInTheDocument();
  });

  it("shows the report item and opens the report dialog for a target", async () => {
    render(<PostActionsMenu targetType="wall_post" targetId="post-1" />);
    await userEvent.click(screen.getByTitle("Меню"));
    await userEvent.click(await screen.findByTitle("Пожаловаться"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Пожаловаться")).toBeInTheDocument();
  });

  it("renders caller-provided items above the report item", async () => {
    render(
      <PostActionsMenu targetType="wall_post" targetId="post-1">
        <button type="button" title="Редактировать">
          Edit
        </button>
      </PostActionsMenu>,
    );
    await userEvent.click(screen.getByTitle("Меню"));
    await waitFor(() => {
      expect(screen.getByTitle("Редактировать")).toBeInTheDocument();
      expect(screen.getByTitle("Пожаловаться")).toBeInTheDocument();
    });
  });

  it("renders no trigger when there is nothing to show", () => {
    render(<PostActionsMenu />);
    expect(screen.queryByTitle("Меню")).not.toBeInTheDocument();
  });

  it("does not render a report item without a target", async () => {
    render(
      <PostActionsMenu>
        <button type="button" title="Редактировать">
          Edit
        </button>
      </PostActionsMenu>,
    );
    await userEvent.click(screen.getByTitle("Меню"));
    await waitFor(() => {
      expect(screen.getByTitle("Редактировать")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Пожаловаться")).not.toBeInTheDocument();
  });

  it("uses the caller's report label and dialog title suffix", async () => {
    render(
      <PostActionsMenu
        targetType="user"
        targetId="u-1"
        reportLabel="Пожаловаться на пользователя"
        reportTargetLabel="на пользователя"
      />,
    );
    await userEvent.click(screen.getByTitle("Меню"));
    await userEvent.click(await screen.findByTitle("Пожаловаться на пользователя"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Пожаловаться на пользователя")).toBeInTheDocument();
  });
});

describe("ReportDialog (via menu)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReportedTargets();
  });

  const openDialog = async (targetId: string) => {
    render(<PostActionsMenu targetType="wall_post" targetId={targetId} />);
    await userEvent.click(screen.getByTitle("Меню"));
    await userEvent.click(await screen.findByTitle("Пожаловаться"));
  };

  it("keeps the submit button disabled until the reason is long enough", async () => {
    await openDialog("post-1");

    const submit = await screen.findByRole("button", { name: "Отправить жалобу" });
    expect(submit).toBeDisabled();

    const textarea = screen.getByPlaceholderText("Опишите проблему подробнее…");
    await userEvent.type(textarea, "short");
    expect(submit).toBeDisabled();

    await userEvent.type(textarea, " this reason is long enough");
    expect(submit).toBeEnabled();
  });

  it("submits the report with the polymorphic target, category and reason", async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: {} });
    await openDialog("post-submit");

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
            target_type: "wall_post",
            target_id: "post-submit",
            category: "fraud",
            reason: "Этот пост выглядит как мошенническая схема с вкладами",
          }),
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("Жалоба отправлена. Спасибо!");
    });
  });

  it("shows a friendly toast when the target was already reported", async () => {
    mockRawRequest.mockRejectedValue({ code: "report_already_exists" });
    await openDialog("post-dup");

    await userEvent.type(
      screen.getByPlaceholderText("Опишите проблему подробнее…"),
      "Эта жалоба должна вернуть ошибку дубликата",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Отправить жалобу" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Вы уже пожаловались на это");
    });
  });

  it("blocks a second report in the same session", async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: {} });
    await openDialog("post-session");

    await userEvent.type(
      screen.getByPlaceholderText("Опишите проблему подробнее…"),
      "Первая жалоба уходит успешно",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Отправить жалобу" }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Жалоба отправлена. Спасибо!");
    });

    // Reopen the menu — the report item is replaced by the disabled state.
    await userEvent.click(screen.getByTitle("Меню"));
    await waitFor(() => {
      expect(screen.queryByTitle("Пожаловаться")).not.toBeInTheDocument();
      expect(screen.getByTitle("Вы уже пожаловались")).toBeInTheDocument();
    });
  });
});
