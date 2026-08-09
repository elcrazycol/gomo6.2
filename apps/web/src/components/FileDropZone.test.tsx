import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FileDropZone } from "./FileDropZone";

function makeEvent(files: File[], types: string[]) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types,
      files,
      dropEffect: "",
    },
  };
}

describe("FileDropZone", () => {
  it("renders children", () => {
    render(<FileDropZone onFiles={vi.fn()}>{() => <button>Кнопка</button>}</FileDropZone>);
    expect(screen.getByText("Кнопка")).toBeInTheDocument();
  });

  it("shows dragging state and forwards dropped files", () => {
    const onFiles = vi.fn();
    render(<FileDropZone onFiles={onFiles}>{() => <button>Кнопка</button>}</FileDropZone>);
    const zone = screen.getByText("Кнопка").closest("div")!;
    const file = new File(["x"], "a.txt", { type: "text/plain" });

    fireEvent.dragEnter(zone, makeEvent([file], ["Files"]));
    expect(zone.className).toContain("ring-2");

    fireEvent.dragOver(zone, makeEvent([file], ["Files"]));
    fireEvent.drop(zone, makeEvent([file], ["Files"]));

    expect(onFiles).toHaveBeenCalledWith([file]);
    // Highlight is cleared after the drop.
    expect(zone.className).not.toContain("ring-2");
  });

  it("clears the highlight on dragleave", () => {
    const states: boolean[] = [];
    render(
      <FileDropZone onFiles={vi.fn()}>
        {(isDragging) => {
          states.push(isDragging);
          return <div>зона</div>;
        }}
      </FileDropZone>,
    );
    const zone = screen.getByText("зона");

    fireEvent.dragEnter(zone, makeEvent([], ["Files"]));
    fireEvent.dragLeave(zone, makeEvent([], ["Files"]));

    expect(states).toEqual([false, true, false]);
  });

  it("ignores drags that do not carry files", () => {
    const onFiles = vi.fn();
    render(<FileDropZone onFiles={onFiles}>{() => <div>зона</div>}</FileDropZone>);
    const zone = screen.getByText("зона");

    fireEvent.dragEnter(zone, makeEvent([], ["text/plain"]));
    expect(zone.className).not.toContain("ring-2");

    fireEvent.drop(zone, makeEvent([], ["text/plain"]));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("blocks drops while disabled", () => {
    const onFiles = vi.fn();
    render(
      <FileDropZone onFiles={onFiles} disabled>
        {() => <div>зона</div>}
      </FileDropZone>,
    );
    const zone = screen.getByText("зона");

    fireEvent.drop(zone, makeEvent([new File(["x"], "a.txt")], ["Files"]));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
