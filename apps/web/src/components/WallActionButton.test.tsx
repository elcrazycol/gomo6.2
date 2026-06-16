import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ActionButton } from "./WallActionButton";

describe("ActionButton", () => {
  it("renders label text", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" onClick={vi.fn()} />);
    expect(screen.getByText("Нравится")).toBeInTheDocument();
  });

  it("renders count when provided", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" count={42} onClick={vi.fn()} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not render count when null", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" count={null} onClick={vi.fn()} />);
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<ActionButton icon={<span>♥</span>} label="Нравится" onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is true", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" disabled onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when loading", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" loading onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("hides label on small screens (sm:inline class)", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" onClick={vi.fn()} />);
    const label = screen.getByText("Нравится");
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("sm:inline");
  });

  it("applies active class when active", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" active onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-primary");
  });

  it("applies muted class when not active", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-muted-foreground");
  });

  it("hides label when showLabel is false", () => {
    render(<ActionButton icon={<span>♥</span>} label="Нравится" showLabel={false} onClick={vi.fn()} />);
    expect(screen.queryByText("Нравится")).not.toBeInTheDocument();
  });
});
