import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsSaveBar } from "./SettingsSaveBar";

const setup = (props: Partial<Parameters<typeof SettingsSaveBar>[0]> = {}) => {
  const onSave = vi.fn();
  const onReset = vi.fn();
  render(<SettingsSaveBar dirty={false} onSave={onSave} onReset={onReset} {...props} />);
  return { onSave, onReset };
};

describe("SettingsSaveBar", () => {
  it("reads as all-saved and blocks Save when there is nothing to save", () => {
    setup({ dirty: false });

    expect(screen.getByText("Всё сохранено")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeDisabled();
  });

  it("announces the number of unsaved changes", () => {
    setup({ dirty: true, changedCount: 3 });

    // role=status so screen readers hear the change without a focus move.
    expect(screen.getByRole("status")).toHaveTextContent("Несохранённых изменений: 3");
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeEnabled();
  });

  it("wires Save and Reset", async () => {
    const { onSave, onReset } = setup({ dirty: true, changedCount: 1 });

    screen.getByRole("button", { name: /Сохранить/ }).click();
    screen.getByRole("button", { name: /Сбросить/ }).click();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while saving", () => {
    setup({ dirty: true, changedCount: 1, saving: true });

    expect(screen.getByRole("button", { name: /Сохранение/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Сбросить/ })).toBeDisabled();
  });
});
