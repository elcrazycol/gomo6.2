import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageComposer } from "./MessageComposer";

describe("MessageComposer", () => {
  const defaultProps = {
    draft: "",
    setDraft: vi.fn(),
    sending: false,
    sendMessage: vi.fn(),
    composerRef: { current: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders textarea with placeholder", () => {
    render(<MessageComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText("Напиши сообщение...");
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("renders send button", () => {
    render(<MessageComposer {...defaultProps} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("disables send button when draft is empty", () => {
    render(<MessageComposer {...defaultProps} draft="" />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("disables send button when sending is true", () => {
    render(<MessageComposer {...defaultProps} draft="hello" sending={true} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("enables send button when draft is non-empty and not sending", () => {
    render(<MessageComposer {...defaultProps} draft="hello" />);
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
  });

  it("calls setDraft on textarea change", async () => {
    const setDraft = vi.fn();
    render(<MessageComposer {...defaultProps} setDraft={setDraft} />);

    const textarea = screen.getByPlaceholderText("Напиши сообщение...");
    await userEvent.type(textarea, "a");

    expect(setDraft).toHaveBeenCalled();
    // setDraft receives the new value from onChange
    const calls = setDraft.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("calls sendMessage on form submit (click send button)", async () => {
    const sendMessage = vi.fn();
    render(<MessageComposer {...defaultProps} draft="hello" sendMessage={sendMessage} />);

    const button = screen.getByRole("button");
    await userEvent.click(button);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("calls sendMessage on Enter keypress (without Shift)", async () => {
    const sendMessage = vi.fn();
    render(<MessageComposer {...defaultProps} draft="hello" sendMessage={sendMessage} />);

    const textarea = screen.getByPlaceholderText("Напиши сообщение...");
    await userEvent.type(textarea, "{enter}");

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not call sendMessage on Shift+Enter", async () => {
    const sendMessage = vi.fn();
    render(<MessageComposer {...defaultProps} draft="hello" sendMessage={sendMessage} />);

    const textarea = screen.getByPlaceholderText("Напиши сообщение...");
    await userEvent.type(textarea, "{Shift>}{enter}{/Shift}");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("shows textarea value from draft prop", () => {
    render(<MessageComposer {...defaultProps} draft="test message" />);
    const textarea = screen.getByPlaceholderText("Напиши сообщение...");
    expect(textarea).toHaveValue("test message");
  });

  it("assigns composerRef to textarea", () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<MessageComposer {...defaultProps} composerRef={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });
});
