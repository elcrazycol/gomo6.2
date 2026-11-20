import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";

vi.mock("@/contexts/EmojiDataContext", () => ({
  useEmojiData: () => ({
    allEmojis: new Map(),
    resolveEmojis: vi.fn(),
    getEmojiUrl: () => null,
    customEmojiList: [],
  }),
}));

async function selectionEditor() {
  const ref = createRef<GomoRichEditorHandle>();
  render(
    <GomoRichEditor
      ref={ref}
      showSelectionToolbar
      showToolbar={false}
      onChange={() => {}}
    />,
  );
  await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy());
  const editor = ref.current!.getEditor()!;
  editor.commands.setContent("<p>hello world</p>");
  editor.commands.selectAll();
  await waitFor(() => expect(screen.getByRole("button", { name: "Жирный" })).toBeInTheDocument());
  return editor;
}

describe("messenger selection toolbar", () => {
  it("offers bold / italic / underline / strike / spoiler over a selection", async () => {
    await selectionEditor();
    for (const label of ["Жирный", "Курсив", "Подчёркнутый", "Зачёркнутый", "Спойлер"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("applies a mark to exactly the selected text", async () => {
    const editor = await selectionEditor();

    fireEvent.click(screen.getByRole("button", { name: "Жирный" }));
    expect(editor.getHTML()).toContain("<strong>hello world</strong>");
    // The selection survives the click (onMouseDown is prevented), so a second
    // mark can be applied to the same words.
    fireEvent.click(screen.getByRole("button", { name: "Спойлер" }));
    expect(editor.getHTML()).toContain("data-spoiler");
  });

  it("does not render a persistent formatting row", async () => {
    await selectionEditor();
    expect(screen.queryByText("Цвет текста")).not.toBeInTheDocument();
    expect(screen.queryByText("Размер шрифта")).not.toBeInTheDocument();
  });
});
