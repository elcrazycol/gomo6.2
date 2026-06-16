import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ModeratorMenu } from "./ModeratorMenu";

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

describe("ModeratorMenu", () => {
  it("renders dropdown", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onBan={vi.fn()} type="post" />);
    expect(screen.getByTestId("dropdown")).toBeInTheDocument();
  });

  it("shows delete option for post", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onBan={vi.fn()} type="post" />);
    expect(screen.getByText(/Удалить пост/)).toBeInTheDocument();
  });

  it("shows delete option for thread", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onBan={vi.fn()} type="thread" />);
    expect(screen.getByText(/Удалить тред/)).toBeInTheDocument();
  });

  it("shows delete option for profile", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onBan={vi.fn()} type="profile" />);
    expect(screen.getByText(/Удалить профиль/)).toBeInTheDocument();
  });

  it("shows edit option when onEdit provided", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onEdit={vi.fn()} onBan={vi.fn()} type="post" />);
    expect(screen.getByText(/Изменить пост/)).toBeInTheDocument();
  });

  it("hides edit option when onEdit not provided", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onBan={vi.fn()} type="post" />);
    expect(screen.queryByText(/Изменить/)).not.toBeInTheDocument();
  });

  it("shows ban option", () => {
    render(<ModeratorMenu onDelete={vi.fn()} onBan={vi.fn()} type="post" />);
    expect(screen.getByText("Забанить пользователя")).toBeInTheDocument();
  });

  it("calls onBan when ban clicked", async () => {
    const onBan = vi.fn();
    render(<ModeratorMenu onDelete={vi.fn()} onBan={onBan} type="post" />);
    screen.getByText("Забанить пользователя").click();
    expect(onBan).toHaveBeenCalledOnce();
  });

  it("calls onDelete when delete clicked", async () => {
    const onDelete = vi.fn();
    render(<ModeratorMenu onDelete={onDelete} onBan={vi.fn()} type="post" />);
    screen.getByText(/Удалить пост/).click();
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
