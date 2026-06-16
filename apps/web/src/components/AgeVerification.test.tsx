import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AgeVerification } from "./AgeVerification";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, className, ...props }: any) => (
    <button onClick={onClick} data-variant={variant} className={className} {...props}>{children}</button>
  ),
}));

describe("AgeVerification", () => {
  it("renders when open", () => {
    render(<AgeVerification open onConfirm={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(/Возрастное ограничение/)).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<AgeVerification open={false} onConfirm={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.queryByText(/Возрастное ограничение/)).not.toBeInTheDocument();
  });

  it("calls onConfirm when confirm button clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<AgeVerification open onConfirm={onConfirm} onDecline={vi.fn()} />);
    await user.click(screen.getByText("Да, мне есть 18 лет"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onDecline when decline button clicked", async () => {
    const onDecline = vi.fn();
    const user = userEvent.setup();
    render(<AgeVerification open onConfirm={vi.fn()} onDecline={onDecline} />);
    await user.click(screen.getByText("Нет, вернуться назад"));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it("shows description text", () => {
    render(<AgeVerification open onConfirm={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(/подтвердить.*18 лет/)).toBeInTheDocument();
  });
});
