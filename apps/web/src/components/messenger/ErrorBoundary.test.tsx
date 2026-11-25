import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageContentBoundary, MessengerErrorBoundary } from "./ErrorBoundary";

function Broken(): never {
  throw new Error("bad card");
}

describe("messenger error boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("contains a broken message to its own bubble", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div className="message-bubble" data-testid="bubble">
        <MessageContentBoundary>
          <Broken />
        </MessageContentBoundary>
      </div>,
    );

    // The bubble survives; only its body is replaced by a one-line notice.
    expect(screen.getByTestId("bubble")).toBeInTheDocument();
    expect(screen.getByText("Не удалось показать сообщение")).toBeInTheDocument();
  });

  it("keeps the whole-messenger fallback compact and retryable", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MessengerErrorBoundary>
        <Broken />
      </MessengerErrorBoundary>,
    );

    // One quiet row, not a hero banner.
    expect(screen.getByText("Мессенджер не открылся")).toBeInTheDocument();
    expect(screen.queryByText(/Пожалуйста, попробуй перезагрузить/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Повторить/ })).toBeInTheDocument();
  });

  it("re-renders the children after a retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Sometimes(): JSX.Element {
      if (shouldThrow) throw new Error("temporary");
      return <span>восстановлено</span>;
    }

    render(
      <MessengerErrorBoundary>
        <Sometimes />
      </MessengerErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /Повторить/ }));
    expect(screen.getByText("восстановлено")).toBeInTheDocument();
  });
});
