import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HighlightText } from "./HighlightText";

describe("HighlightText", () => {
  it("wraps every occurrence of the query in <mark>", () => {
    const { container } = render(<HighlightText text="Hello world hello" query="hello" />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("Hello");
    expect(container.textContent).toBe("Hello world hello");
  });

  it("renders plain text when the query is empty", () => {
    const { container } = render(<HighlightText text="Hello" query="" />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("Hello");
  });

  it("ignores single-character terms", () => {
    const { container } = render(<HighlightText text="abc" query="a" />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("treats regex metacharacters literally", () => {
    const { container } = render(<HighlightText text="xa.y" query="a." />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("a.");
  });

  it("handles null text", () => {
    const { container } = render(<HighlightText text={null} query="x" />);
    expect(container.textContent).toBe("");
  });
});
