import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SlashCommandList, type SlashCommandListHandle } from "./SlashCommandList";
import { slashItems } from "./slashCommands";

describe("SlashCommandList", () => {
  it("runs the clicked command", () => {
    const command = vi.fn();
    render(<SlashCommandList items={slashItems} command={command} query="" />);

    fireEvent.click(screen.getByText("Галерея"));

    expect(command).toHaveBeenCalledWith(expect.objectContaining({ key: "gallery" }));
  });

  it("moves with arrows and runs the highlighted item on Enter", () => {
    const command = vi.fn();
    const ref = createRef<SlashCommandListHandle>();
    render(<SlashCommandList ref={ref} items={slashItems} command={command} query="" />);

    const key = (k: string) => new KeyboardEvent("keydown", { key: k });
    // Each keydown re-renders (as in the editor), so flush between them.
    act(() => {
      ref.current!.onKeyDown({ event: key("ArrowDown") } as never);
    });
    act(() => {
      ref.current!.onKeyDown({ event: key("Enter") } as never);
    });

    expect(command).toHaveBeenCalledWith(expect.objectContaining({ key: slashItems[1].key }));
  });

  it("shows the query chip and the empty state", () => {
    render(<SlashCommandList items={[]} command={vi.fn()} query="zzz" />);

    expect(screen.getByText("/zzz")).toBeInTheDocument();
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });
});
