import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { FavoriteButton } from "@/components/FavoriteButton";
import { useFavoritesStore } from "@/stores/favoritesStore";

const requestMock = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: (...args: any[]) => requestMock(...args) },
}));

describe("FavoriteButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFavoritesStore.getState().reset();
    requestMock.mockResolvedValue({ data: { ok: true } });
  });

  it("adds to favorites on click", async () => {
    const user = userEvent.setup();
    render(<FavoriteButton itemType="thread" itemId="t1" />);

    const button = screen.getByRole("button", { name: "В избранное" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/favorites", {
        method: "POST",
        body: JSON.stringify({ item_type: "thread", item_id: "t1" }),
      }),
    );
    expect(screen.getByRole("button", { name: "Убрать из избранного" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("removes an existing favorite on click", async () => {
    useFavoritesStore.setState({ ids: new Set(["thread:t1"]), loaded: true });
    const user = userEvent.setup();
    render(<FavoriteButton itemType="thread" itemId="t1" />);

    const button = screen.getByRole("button", { name: "Убрать из избранного" });
    await user.click(button);

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/favorites/thread/t1", { method: "DELETE" }),
    );
    expect(screen.getByRole("button", { name: "В избранное" })).toHaveAttribute("aria-pressed", "false");
  });
});
