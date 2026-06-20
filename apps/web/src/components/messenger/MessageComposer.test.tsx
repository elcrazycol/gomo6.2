import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { MessageComposer } from "./MessageComposer";
import type { RefObject } from "react";

// Mock CSS.supports which is not available in jsdom
beforeAll(() => {
  if (typeof CSS === "undefined") {
    (globalThis as any).CSS = { supports: vi.fn().mockReturnValue(false) };
  } else if (!CSS.supports) {
    CSS.supports = vi.fn().mockReturnValue(false) as any;
  }
});

describe("MessageComposer", () => {
  function setup(overrides: {
    draft?: string;
    isSending?: boolean;
    onTyping?: (isTyping: boolean) => void;
  } = {}) {
    const setDraft = vi.fn();
    const onSend = vi.fn();
    const onTyping = overrides.onTyping ?? vi.fn();
    const composerRef: RefObject<HTMLTextAreaElement | null> = { current: null };

    const utils = render(
      <MessageComposer
        draft={overrides.draft ?? ""}
        setDraft={setDraft}
        isSending={overrides.isSending ?? false}
        onSend={onSend}
        composerRef={composerRef}
        onTyping={onTyping}
      />,
    );

    const textarea = screen.getByPlaceholderText("Напиши сообщение...") as HTMLTextAreaElement;
    const button = screen.getByRole("button") as HTMLButtonElement;

    return { ...utils, setDraft, onSend, onTyping, textarea, button };
  }

  it("renders textarea and send button", () => {
    const { textarea, button } = setup();
    expect(textarea).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it("send button is disabled when draft is empty", () => {
    const { button } = setup({ draft: "" });
    expect(button).toBeDisabled();
  });

  it("send button is enabled when draft has content", () => {
    const { button } = setup({ draft: "Hello" });
    expect(button).not.toBeDisabled();
  });

  it("send button is disabled when isSending is true", () => {
    const { button } = setup({ draft: "Hello", isSending: true });
    expect(button).toBeDisabled();
  });

  it("calls onSend when Enter is pressed (no shift)", async () => {
    const { textarea, onSend, onTyping } = setup({ draft: "Hello" });

    await userEvent.type(textarea, "Hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
      expect(onTyping).toHaveBeenCalledWith(false);
    });
  });

  it("does not call onSend when Shift+Enter is pressed", async () => {
    const { textarea, onSend } = setup({ draft: "Hello" });

    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onSend when form is submitted", async () => {
    const { onSend } = setup({ draft: "Hello" });
    const form = document.querySelector("form")!;

    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
    });
  });

  it("shows counter when remaining < 100 chars", () => {
    const longText = "a".repeat(3901);
    setup({ draft: longText });

    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("applies critical class when remaining < 20", () => {
    const longText = "a".repeat(3982);
    const { container } = render(
      <MessageComposer
        draft={longText}
        setDraft={vi.fn()}
        isSending={false}
        onSend={vi.fn()}
        composerRef={{ current: null }}
      />,
    );

    const counter = container.querySelector(".is-critical");
    expect(counter).toBeInTheDocument();
  });

  it("does not show counter when remaining >= 100", () => {
    setup({ draft: "short" });
    expect(screen.queryByText(/\d+/)).not.toBeInTheDocument();
  });

  it("enforces max length on input", () => {
    const { setDraft } = setup();
    const longText = "a".repeat(4001);
    const textarea = screen.getByPlaceholderText("Напиши сообщение...");

    fireEvent.change(textarea, { target: { value: longText } });

    // setDraft should not be called with > MAX_LENGTH content
    const calls = setDraft.mock.calls;
    if (calls.length > 0) {
      expect(calls[0][0].length).toBeLessThanOrEqual(4000);
    }
  });

  it("calls onTyping(true) when user starts typing", () => {
    const onTyping = vi.fn();
    setup({ onTyping, draft: "" });

    const textarea = screen.getByPlaceholderText("Напиши сообщение...");
    fireEvent.change(textarea, { target: { value: "H" } });

    expect(onTyping).toHaveBeenCalledWith(true);
  });
});
