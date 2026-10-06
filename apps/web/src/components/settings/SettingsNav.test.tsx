import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { SettingsSearch, type SearchEntry } from "./SettingsNav";

const setup = () => {
  const onNavigate = vi.fn();
  render(<SettingsSearch onNavigate={onNavigate} />);
  return { onNavigate, input: screen.getByPlaceholderText("Поиск по настройкам") };
};

describe("SettingsSearch", () => {
  it("shows nothing until something is typed", async () => {
    const { input } = setup();
    await userEvent.click(input);
    expect(screen.queryByRole("button", { name: /Пароль/ })).not.toBeInTheDocument();
  });

  it("filters across sections and jumps to the exact row", async () => {
    const { input, onNavigate } = setup();

    await userEvent.type(input, "пароль");

    const result = screen.getByRole("button", { name: /Пароль/ });
    await userEvent.click(result);

    const entry = onNavigate.mock.calls[0][0] as SearchEntry;
    expect(entry.section).toBe("security");
    expect(entry.anchor).toBe("set-password");
  });

  it("matches on keywords, not just the visible label", async () => {
    const { input } = setup();

    await userEvent.type(input, "spotify");

    expect(screen.getByRole("button", { name: /Интеграции/ })).toBeInTheDocument();
  });

  it("clears the query with the clear button", async () => {
    const { input } = setup();

    await userEvent.type(input, "тема");
    await userEvent.click(screen.getByLabelText("Очистить поиск"));
    expect(input).toHaveValue("");
  });
});
