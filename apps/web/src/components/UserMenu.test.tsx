import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { UserMenu } from "./UserMenu";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown">{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

describe("UserMenu", () => {
  it("renders dropdown with menu items", () => {
    render(<UserMenu onEdit={vi.fn()} onDelete={vi.fn()} onReport={vi.fn()} type="post" />);
    expect(screen.getByTestId("dropdown")).toBeInTheDocument();
  });

  it("shows edit option for post type", () => {
    render(<UserMenu onEdit={vi.fn()} onDelete={vi.fn()} onReport={vi.fn()} type="post" />);
    expect(screen.getByText(/Изменить пост/)).toBeInTheDocument();
  });

  it("shows edit option for thread type", () => {
    render(<UserMenu onEdit={vi.fn()} onDelete={vi.fn()} onReport={vi.fn()} type="thread" />);
    expect(screen.getByText(/Изменить тред/)).toBeInTheDocument();
  });

  it("calls onEdit when edit clicked", async () => {
    const onEdit = vi.fn();
    render(<UserMenu onEdit={onEdit} onDelete={vi.fn()} onReport={vi.fn()} type="post" />);
    screen.getByText(/Изменить пост/).click();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("calls onDelete when delete clicked", async () => {
    const onDelete = vi.fn();
    render(<UserMenu onEdit={vi.fn()} onDelete={onDelete} onReport={vi.fn()} type="post" />);
    screen.getByText(/Удалить пост/).click();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("calls onReport when report clicked", async () => {
    const onReport = vi.fn();
    render(<UserMenu onEdit={vi.fn()} onDelete={vi.fn()} onReport={onReport} type="post" />);
    screen.getByText("Пожаловаться").click();
    expect(onReport).toHaveBeenCalledOnce();
  });
});
