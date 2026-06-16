import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScrollToBottomButton } from "./ScrollToBottomButton";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, title, className, ...props }: any) => (
    <button onClick={onClick} title={title} className={className} {...props}>{children}</button>
  ),
}));

describe("ScrollToBottomButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when scrolled to bottom", () => {
    const { container } = render(<ScrollToBottomButton />);
    expect(container.querySelector("button")).not.toBeInTheDocument();
  });

  it("renders when scrolled away from bottom", () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(target, "scrollHeight", { value: 2000, writable: true });
    Object.defineProperty(target, "clientHeight", { value: 500, writable: true });

    render(<ScrollToBottomButton targetElement={target} />);
    expect(screen.getByTitle("Перейти к последним сообщениям")).toBeInTheDocument();
  });

  it("calls scrollTo on click", () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(target, "scrollHeight", { value: 2000, writable: true });
    Object.defineProperty(target, "clientHeight", { value: 500, writable: true });
    target.scrollTo = vi.fn() as any;

    render(<ScrollToBottomButton targetElement={target} />);
    fireEvent.click(screen.getByTitle("Перейти к последним сообщениям"));
    expect(target.scrollTo).toHaveBeenCalled();
  });

  it("applies custom className", () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(target, "scrollHeight", { value: 2000, writable: true });
    Object.defineProperty(target, "clientHeight", { value: 500, writable: true });

    render(<ScrollToBottomButton targetElement={target} className="custom" />);
    expect(screen.getByTitle("Перейти к последним сообщениям").className).toContain("custom");
  });

  it("respects custom threshold", () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollTop", { value: 900, writable: true });
    Object.defineProperty(target, "scrollHeight", { value: 1000, writable: true });
    Object.defineProperty(target, "clientHeight", { value: 500, writable: true });

    // Distance from bottom = 1000 - 900 - 500 = -400 → not visible with threshold 200
    render(<ScrollToBottomButton targetElement={target} threshold={200} />);
    expect(screen.queryByTitle("Перейти к последним сообщениям")).not.toBeInTheDocument();
  });
});
