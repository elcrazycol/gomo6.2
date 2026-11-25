import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotesPinnedBanner } from "./NotesPinnedBanner";
import type { MessageView } from "./types";

function note(overrides: Partial<MessageView> = {}): MessageView {
  return {
    id: "note-1",
    conversation_id: "notes-1",
    sender_user_id: "me",
    parent_message_id: null,
    content: "первая заметка",
    is_edited: false,
    is_deleted: false,
    edited_at: null,
    sent_at: "2026-01-01T10:00:00Z",
    client_id: "c1",
    ...overrides,
  } as MessageView;
}

const notes = [
  note({ id: "n1", content: "первая заметка" }),
  note({ id: "n2", content: "вторая заметка" }),
  note({ id: "n3", content: "третья заметка" }),
];

describe("NotesPinnedBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is ONE compact row with a preview and a position counter", () => {
    const { container } = render(<NotesPinnedBanner notes={notes} onJump={vi.fn()} />);

    expect(container.querySelector(".notes-pinned-banner")).toBeInTheDocument();
    expect(screen.getByText("Закреплённые заметки")).toBeInTheDocument();
    expect(screen.getByText("первая заметка")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("cycles through the pins on tap", () => {
    const onJump = vi.fn();
    render(<NotesPinnedBanner notes={notes} onJump={onJump} />);

    fireEvent.click(screen.getByRole("button", { name: /Закреплённые заметки/ }));
    expect(onJump).toHaveBeenLastCalledWith("n2");
    expect(screen.getByText("вторая заметка")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Закреплённые заметки/ }));
    expect(onJump).toHaveBeenLastCalledWith("n3");

    // Wraps around: the bar is a cycle, never a dead end.
    fireEvent.click(screen.getByRole("button", { name: /Закреплённые заметки/ }));
    expect(onJump).toHaveBeenLastCalledWith("n1");
  });

  it("opens the short list and jumps to the chosen pin", () => {
    const onJump = vi.fn();
    render(<NotesPinnedBanner notes={notes} onJump={onJump} />);

    fireEvent.click(screen.getByRole("button", { name: "Все закреплённые заметки" }));
    expect(screen.getByText("Закреплённые · 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /третья заметка/ }));
    expect(onJump).toHaveBeenCalledWith("n3");
  });

  it("renders nothing when there are no pinned notes", () => {
    const { container } = render(<NotesPinnedBanner notes={[]} onJump={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("never renders a deleted note", () => {
    const { container } = render(
      <NotesPinnedBanner
        notes={[note({ content: "секрет", is_deleted: true })]}
        onJump={vi.fn()}
      />,
    );
    // A deleted note leaves no trace at all — not even a «Удалено» row.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("секрет")).not.toBeInTheDocument();
    expect(screen.queryByText("Удалено")).not.toBeInTheDocument();
  });

  it("skips a deleted note but keeps the live ones", () => {
    render(
      <NotesPinnedBanner
        notes={[
          note({ id: "n1", content: "первая", is_deleted: true }),
          note({ id: "n2", content: "вторая" }),
        ]}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByText("вторая")).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.queryByText("первая")).not.toBeInTheDocument();
  });
});
