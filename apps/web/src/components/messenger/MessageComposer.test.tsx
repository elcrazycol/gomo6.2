import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type RefObject } from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { MessageComposer } from "./MessageComposer";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockHaptics } = vi.hoisted(() => ({
  mockHaptics: { tick: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/haptics", () => ({
  hapticTick: mockHaptics.tick,
  hapticSuccess: mockHaptics.success,
}));


const editorSpies = vi.hoisted(() => ({
  insertEmojiOpts: [] as any[],
  focusCalls: [] as boolean[],
  toolbarVisibility: [] as boolean[],
  clearCalls: 0,
  events: [] as string[],
  // Mutable so a test can attach a fake state/view/on/off for the caret.
  mockEditor: { isActive: () => false } as any,
}));

const makeDoc = (value: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

vi.mock("@/components/GomoRichEditor", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const mockEditor = editorSpies.mockEditor;
  return {
    GomoRichEditor: React.forwardRef(
      (
        {
          placeholder,
          onChange,
          onSubmit,
          resetKey,
          contentJson,
          minHeightClassName,
          maxHeightClassName,
          showToolbar,
          showSelectionToolbar,
          toolbarClassName,
        }: any,
        ref: any
      ) => {
        React.useEffect(() => {
          editorSpies.toolbarVisibility.push(Boolean(showToolbar));
        });
        const handle = {
          focus: () => {
            editorSpies.focusCalls.push(true);
          },
          insertText: (value: string) => {
            onChange?.({ json: makeDoc(value), text: value });
          },
          clear: () => {
            editorSpies.clearCalls += 1;
            editorSpies.events.push("clear");
            onChange?.({ json: makeDoc(""), text: "" });
          },
          insertEmoji: (
            data: { emojiId: string; packId: string; url: string; name: string },
            opts?: { focus?: boolean }
          ) => {
            editorSpies.insertEmojiOpts.push(opts ?? null);
            onChange?.({ json: makeDoc(`[e:${data.emojiId}]`), text: `[e:${data.emojiId}]` });
          },
          getEditor: () => mockEditor,
        };
        if (typeof ref === "function") {
          ref(handle);
        } else if (ref) {
          ref.current = handle;
        }
        return (
          <div
            data-testid="gomo-rich-editor"
            data-min-height={minHeightClassName}
            data-max-height={maxHeightClassName}
            data-show-toolbar={showToolbar ? "true" : "false"}
            data-selection-toolbar={showSelectionToolbar ? "true" : "false"}
            data-toolbar-class={toolbarClassName ?? ""}
            data-reset-key={resetKey}
          >
            <textarea
              data-testid="rich-editor-textarea"
              placeholder={placeholder}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit?.();
                }
              }}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                onChange?.({ json: makeDoc(e.target.value), text: e.target.value })
              }
            />
          </div>
        );
      }
    ),
    // The formatting panel renders the toolbar OUTSIDE the editor, so the
    // mock must expose it too.
    Toolbar: ({ editor, className }: any) => (
      <div data-testid="external-toolbar" data-editor={editor ? "yes" : "no"} data-class={className ?? ""}>
        toolbar
      </div>
    ),
    GomoRichEditorHandle: null,
  };
});

vi.mock("./VoiceRecorder", () => ({
  VoiceRecorder: ({ onRowLockChange }: { onRowLockChange?: (locked: boolean) => void }) => (
    <div className="voice-record is-ready" data-testid="voice-recorder">
      <button type="button" aria-label="Открыть черновик" onClick={() => onRowLockChange?.(true)}>
        open
      </button>
    </div>
  ),
}));

vi.mock("@/components/EmojiPicker", () => ({
  EmojiPicker: ({ onEmojiSelect, children, onSwapToggle, swapOpen, onSwapClose }: any) => (
    <div data-testid="emoji-picker" data-swap-open={swapOpen ? "true" : "false"}>
      <button data-testid="swap-toggle" onClick={() => onSwapToggle?.()}>
        swap
      </button>
      <button data-testid="swap-close" onClick={() => onSwapClose?.()}>
        close-swap
      </button>
      <button
        data-testid="insert-emoji"
        onClick={() =>
          onEmojiSelect({ emojiId: "test-emoji-id", packId: "test-pack", url: "/test.webp", name: "test" })
        }
      >
        😀
      </button>
      {children}
    </div>
  ),
}));

const { mockEmojiSwap } = vi.hoisted(() => ({
  mockEmojiSwap: {
    isTouch: false,
    open: false,
    height: 0,
    toggle: vi.fn(),
    // Faithful to the real hook's closePanel: it flips the swap closed in
    // the same batch (so the sheet's exit slide and the composer's lift
    // handoff see the closed swap on the very next render, like on device).
    closePanel: vi.fn((refocus: boolean) => {
      mockEmojiSwap.open = false;
      mockEmojiSwap.isSheetVisible = () => true;
      void refocus;
    }),
    isSheetVisible: vi.fn(() => false),
  } as any,
}));

vi.mock("@/hooks/useEmojiKeyboardSwap", () => ({
  useEmojiKeyboardSwap: () => mockEmojiSwap,
}));

const { mockMobileKeyboard } = vi.hoisted(() => ({
  mockMobileKeyboard: { keyboardInset: 0, viewportHeight: 0 } as any,
}));

vi.mock("@/hooks/useMobileKeyboard", () => ({
  useMobileKeyboard: () => mockMobileKeyboard,
}));

// The composer's diagnostics strip reads the keyboard state directly via
// getMobileKeyboardState — point it at the same mock.
vi.mock("@/lib/mobileKeyboard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mobileKeyboard")>();
  return { ...mod, getMobileKeyboardState: () => mockMobileKeyboard };
});

// CSS.supports is not available in jsdom
beforeAll(() => {
  if (typeof CSS === "undefined") {
    (globalThis as any).CSS = { supports: vi.fn().mockReturnValue(false) };
  } else if (!CSS.supports) {
    CSS.supports = vi.fn().mockReturnValue(false) as any;
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setup(overrides: {
  draft?: string;
  isSending?: boolean;
  onTyping?: (isTyping: boolean) => void;
  composerRef?: RefObject<{ focus: () => void; insertText: (text: string) => void; clear: () => void; insertEmoji: (data: unknown, opts?: { focus?: boolean }) => void; getEditor: () => null } | null>;
} = {}) {
  const setDraft = vi.fn();
  const onSend = vi.fn();
  const onTyping = overrides.onTyping ?? vi.fn();
  const composerRef = overrides.composerRef ?? { current: null };

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
  const sendButton = screen.getByRole("button", { name: /send|отправить/i }) as HTMLButtonElement;

  return { ...utils, setDraft, onSend, onTyping, textarea, sendButton, composerRef };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MessageComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorSpies.insertEmojiOpts.length = 0;
    editorSpies.focusCalls.length = 0;
    editorSpies.toolbarVisibility.length = 0;
    editorSpies.clearCalls = 0;
    editorSpies.events.length = 0;
    mockEmojiSwap.open = false;
    mockEmojiSwap.isTouch = false;
    mockEmojiSwap.isSheetVisible = () => false;
    mockEmojiSwap.toggle = vi.fn();
    mockEmojiSwap.closePanel = vi.fn((refocus: boolean) => {
      mockEmojiSwap.open = false;
      void refocus;
    });
    mockMobileKeyboard.keyboardInset = 0;
    mockMobileKeyboard.viewportHeight = 0;
    mockMobileKeyboard.isTouch = false;
    delete editorSpies.mockEditor.state;
    delete editorSpies.mockEditor.view;
    delete editorSpies.mockEditor.on;
    delete editorSpies.mockEditor.off;
    delete editorSpies.mockEditor.isDestroyed;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the always-visible composer with emoji and send buttons", () => {
    const { textarea, sendButton } = setup();
    expect(textarea).toBeInTheDocument();
    expect(sendButton).toBeInTheDocument();
    // No article-editor toggle: formatting lives in the selection bubble.
    expect(screen.queryByRole("button", { name: "Развернуть компоузер" })).not.toBeInTheDocument();
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-selection-toolbar", "true");
    // The editor is always at the full input height — no collapsed pill.
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");
  });

  it("keeps the editor focused when pressing the composer chrome (pill padding, empty row space)", () => {
    const { container, textarea } = setup();
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    const blurSpy = vi.fn();
    textarea.addEventListener("blur", blurSpy);
    const press = (el: Element, button = 0) => {
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
      el.dispatchEvent(ev);
      return ev;
    };
    // A press on non-interactive composer chrome is preventDefault'ed — the
    // browser's default focus move (blur → mobile keyboard dismiss) is
    // cancelled, so the editor keeps focus.
    const root = container.querySelector(".composer") as HTMLElement;
    const pill = container.querySelector(".composer-input-pill") as HTMLElement;
    expect(press(pill).defaultPrevented).toBe(true);
    expect(press(root).defaultPrevented).toBe(true);
    expect(blurSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
    // Interactive controls keep their native behaviour — the emoji trigger
    // must still be pressable, its own handlers own the focus.
    expect(press(screen.getByLabelText("Добавить эмодзи")).defaultPrevented).toBe(false);
    // Non-primary buttons are left alone too (middle-click paste, etc.).
    expect(press(pill, 1).defaultPrevented).toBe(false);
  });

  it("keeps the editor focused when pressing the disabled send button (empty composer)", () => {
    const { sendButton } = setup();
    expect(sendButton).toBeDisabled();
    // A tap on the inert disabled button must not move focus (on iOS it would
    // dismiss the keyboard): the guard covers disabled buttons as chrome.
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    sendButton.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("desktop: the paperclip opens the native picker directly, no attach sheet", () => {
    const { container } = setup();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("attach-sheet")).not.toBeInTheDocument();
  });

  it("touch: the paperclip opens the attach sheet in the keyboard slot (no native picker)", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    mockEmojiSwap.open = true; // the shared keyboard slot came up
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(screen.getByTestId("attach-sheet")).toBeInTheDocument();
    // The slot was already open — the trigger only switched its content, no
    // toggle (and no keyboard summoned).
    expect(mockEmojiSwap.toggle).not.toHaveBeenCalled();
  });

  it("touch: an attach option reconfigures the hidden input; window focus ends the session and returns the keyboard", () => {
    mockMobileKeyboard.isTouch = true;
    const { container } = setup();
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Камера" }));
    expect(input.getAttribute("accept")).toBe("image/*");
    expect(input.getAttribute("capture")).toBe("environment");
    // The native sheet closed (page regained focus): the attach session ends,
    // the keyboard returns via the swap's closePanel, and the attach sheet
    // exits with its slide (it unmounts after the exit animation).
    fireEvent.focus(window);
    expect(screen.getByTestId("attach-sheet")).toHaveClass("is-closing");
    expect(mockEmojiSwap.closePanel).toHaveBeenCalledWith(true);
  });

  it("touch: re-tapping the paperclip closes the sheet and returns the keyboard", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(screen.getByTestId("attach-sheet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    // The swap closes with the keyboard returning; the sheet exits with its
    // slide (it unmounts after the exit animation).
    expect(screen.getByTestId("attach-sheet")).toHaveClass("is-closing");
    expect(mockEmojiSwap.closePanel).toHaveBeenCalledWith(true);
  });

  it("touch: tapping outside the attach sheet closes it WITHOUT the keyboard", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    const sheet = screen.getByTestId("attach-sheet");
    // A tap inside the sheet (on an option) must NOT close it.
    fireEvent.mouseDown(screen.getByRole("button", { name: "Камера" }));
    expect(sheet).toBeInTheDocument();
    expect(mockEmojiSwap.closePanel).not.toHaveBeenCalled();
    // A tap outside (on the message list / page) closes it: the swap flips
    // closed inside closePanel (same batch), the panel exits with a glide
    // (is-closing) and the keyboard does NOT return — the editor was
    // deliberately blurred by the swap, so the composer slides down with the
    // departing sheet instead.
    fireEvent.mouseDown(document.body);
    expect(mockEmojiSwap.closePanel).toHaveBeenCalledWith(false);
    expect(sheet).toHaveClass("is-closing");
  });

  it("touch: tapping the editor does NOT close the attach sheet via the outside handler (the tap's own focus owns it)", () => {
    mockMobileKeyboard.isTouch = true;
    const { textarea } = setup();
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    const sheet = screen.getByTestId("attach-sheet");
    // A tap on the editor must not close the sheet here: the focus lands on an
    // editable, the hook's focusin flips the swap closed, and the composer
    // keeps its lift while the keyboard returns (no glide-down blink).
    fireEvent.mouseDown(textarea);
    expect(sheet).toBeInTheDocument();
    expect(mockEmojiSwap.closePanel).not.toHaveBeenCalled();
    // Emulate the focusin close: the swap flips closed with the editor
    // focused — the sheet exits with its slide, keyboard returning.
    fireEvent.focus(textarea);
    mockEmojiSwap.open = false;
    fireEvent.mouseDown(document.body);
    expect(sheet).toHaveClass("is-closing");
  });

  it("touch: Escape closes the attach sheet WITHOUT the keyboard", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("attach-sheet")).toHaveClass("is-closing");
    expect(mockEmojiSwap.closePanel).toHaveBeenCalledWith(false);
  });

  it("touch: the paperclip switches the open slot from the emoji panel to the attach sheet", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(screen.getByTestId("attach-sheet")).toBeInTheDocument();
    // The emoji picker is no longer the active sheet — the swap stays up,
    // only the slot's content switched.
    expect(screen.getByTestId("emoji-picker")).toHaveAttribute("data-swap-open", "false");
  });

  it("keyboard slot: freezes the lift at the full visual slot (URL bar included), releases it in one step on close", async () => {
    mockEmojiSwap.height = 300;
    mockMobileKeyboard.keyboardInset = 0;
    // The keyboard was up with the iOS URL bar expanded: the full slot delta
    // (innerHeight − visualViewport.height) exceeds the keyboard's own height.
    mockMobileKeyboard.viewportHeight = window.innerHeight - 360; // delta = 360
    const { container, rerender } = render(
      <div className="chat-panel">
        <MessageComposer
          draft=""
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
        />
      </div>,
    );
    const panel = container.querySelector(".chat-panel") as HTMLElement;
    const textarea = screen.getByPlaceholderText("Напиши сообщение...") as HTMLTextAreaElement;
    // Re-render so the lift effect sees the mutated keyboard mock values.
    const poke = () => rerender(
      <div className="chat-panel">
        <MessageComposer
          draft=""
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
        />
      </div>,
    );
    // Open the sheet: the lift freezes at the FULL slot (360), not the
    // keyboard height (300) — otherwise the panel would get less space than
    // the keyboard and the composer would sit a hair low.
    mockEmojiSwap.open = true;
    poke();
    await waitFor(() => expect(panel.style.getPropertyValue("--kb-inset")).toBe("360px"));
    // Close with the keyboard returning (tap on the editor): the local freeze
    // is removed in ONE step — no hold, no glide. From here the live global
    // geometry owns the composer (the keyboard rides up with it).
    textarea.focus();
    mockEmojiSwap.open = false;
    mockMobileKeyboard.keyboardInset = 0;
    poke();
    expect(panel.style.getPropertyValue("--kb-inset")).toBe("");
    // The keyboard is back at its full height — the local override stays gone:
    // the global variable (not the freeze) positions the composer now.
    mockMobileKeyboard.keyboardInset = 360;
    poke();
    expect(panel.style.getPropertyValue("--kb-inset")).toBe("");
    mockMobileKeyboard.viewportHeight = window.innerHeight - 359;
    poke();
    expect(panel.style.getPropertyValue("--kb-inset")).toBe("");
  });

  it("keeps the full input height regardless of focus, paperclip always on the left", () => {
    const { textarea } = setup();
    fireEvent.focus(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");
    // The paperclip is always available; no formatting row above the field.
    expect(screen.getByRole("button", { name: "Прикрепить файл" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Развернуть компоузер" })).not.toBeInTheDocument();
  });

  it("stays at the full input height after blur (no collapsing animation)", () => {
    const { textarea } = setup();
    fireEvent.focus(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");

    fireEvent.blur(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");
  });

  it("does not collapse on blur when the draft is not empty", () => {
    const { textarea } = setup({ draft: "Hello" });
    fireEvent.focus(textarea);
    fireEvent.blur(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");
  });

  it("send button is disabled when draft is empty", () => {
    const { sendButton } = setup({ draft: "" });
    expect(sendButton).toBeDisabled();
  });

  it("send button is enabled when draft has content", () => {
    const { sendButton } = setup({ draft: "Hello" });
    expect(sendButton).not.toBeDisabled();
  });

  it("send button is enabled for an emoji-only draft", () => {
    const { sendButton } = setup({ draft: "[e:abc-123]" });
    expect(sendButton).not.toBeDisabled();
  });

  it("keeps the send button live while an earlier message is still sending", () => {
    // Telegram's clock is not a lock: a burst of messages is normal, and the
    // outbox delivers them in order.
    const { sendButton, onSend } = setup({ draft: "Second message", isSending: true });
    expect(sendButton).not.toBeDisabled();
    void userEvent.click(sendButton);
    return waitFor(() => expect(onSend).toHaveBeenCalled());
  });

  it("sends via the send button", async () => {
    const { sendButton, onSend } = setup({ draft: "Hello" });
    await userEvent.click(sendButton);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
  });

  it("confirms a send with the tactile cue", async () => {
    mockHaptics.success.mockClear();
    const { sendButton } = setup({ draft: "Hello" });

    await userEvent.click(sendButton);

    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
  });

  it("calls onSend when Enter is pressed (desktop)", async () => {
    const { textarea, onSend } = setup({ draft: "Hello" });
    await userEvent.type(textarea, "Hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
  });

  it("does not send on Shift+Enter", async () => {
    const { textarea, onSend } = setup({ draft: "Hello" });
    await userEvent.type(textarea, "Hello");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears the editor in the same tick as Enter, before onSend", async () => {
    // The optimistic send resolves only after the network round-trip. Clearing
    // must not wait for it — otherwise the sent text (and ProseMirror's Enter
    // paragraph) stays visible for the whole request.
    const onSend = vi.fn(() => editorSpies.events.push("send"));
    const composerRef = { current: null } as RefObject<{
      insertText: (text: string) => void;
    } | null>;

    function Host() {
      const [draft, setDraft] = useState("");
      return (
        <MessageComposer
          draft={draft}
          setDraft={setDraft}
          isSending={false}
          onSend={onSend}
          composerRef={composerRef as never}
        />
      );
    }

    render(<Host />);
    act(() => composerRef.current?.insertText("hi"));

    const textarea = screen.getByTestId("rich-editor-textarea");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(editorSpies.clearCalls).toBe(1);
    // Synchronously, in this order — so the text is gone the moment it is sent.
    expect(editorSpies.events).toEqual(["clear", "send"]);
  });

  it("calls onTyping(true) when the user starts typing", () => {
    const onTyping = vi.fn();
    const { textarea } = setup({ onTyping, draft: "" });
    fireEvent.change(textarea, { target: { value: "H" } });
    expect(onTyping).toHaveBeenCalledWith(true);
  });

  it("serializes editor output into the messenger wire format", async () => {
    const { setDraft, textarea } = setup();
    await userEvent.type(textarea, "hi");
    expect(setDraft).toHaveBeenCalledWith("hi");
  });

  it("shows the counter when remaining < 100 chars", () => {
    const longText = "a".repeat(3901);
    setup({ draft: longText });
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("applies the critical class when remaining < 20", () => {
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
    expect(container.querySelector(".is-critical")).toBeInTheDocument();
  });

  it("does not show the counter when remaining >= 100", () => {
    setup({ draft: "short" });
    expect(screen.queryByText(/\d+/)).not.toBeInTheDocument();
  });

  it("disables send while files are uploading and shows progress", () => {
    render(
      <MessageComposer
        draft="Привет"
        setDraft={vi.fn()}
        isSending={false}
        onSend={vi.fn()}
        composerRef={{ current: null }}
        uploadingFiles={[{ id: "u1", name: "photo.png", percent: 42, type: "image" }]}
      />,
    );
    const button = screen.getByRole("button", { name: /send|отправить/i }) as HTMLButtonElement;
    expect(button).toBeDisabled();
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("has no article editor, formatting row or fullscreen shell", () => {
    const { container } = setup({ draft: "Hello" });
    // Telegram's composer: paperclip, field with emoji, mic/send. Nothing else.
    expect(container.querySelector(".composer-panel-row")).not.toBeInTheDocument();
    expect(container.querySelector(".composer-fs-overlay")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "На весь экран" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("external-toolbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Прикрепить файл" })).toBeInTheDocument();
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-max-height", "max-h-[128px] overflow-y-auto overscroll-contain");
  });

  describe("emoji panel ↔ keyboard", () => {
    it("keeps the chat panel's bottom at the emoji panel height while it is open", () => {
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      // The keyboard is up at the panel height when the swap opens (realistic).
      mockMobileKeyboard.keyboardInset = 340;
      // No URL bar: the keyboard occupied the full delta (innerHeight − vv).
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      const { container } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
    });

    it("releases the lift once the swap panel is gone", () => {
      mockEmojiSwap.open = false;
      mockEmojiSwap.height = 0;
      const { container } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
    });

    it("keeps the composer glued to the panel while it is open, even when the keyboard height matches at swap time", () => {
      // At the moment the swap opens the keyboard is still up at the panel
      // height — the handoff must not fire then (it would drop the lift and
      // the composer would fall under the panel as the keyboard dismisses).
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      mockMobileKeyboard.keyboardInset = 340;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // The keyboard dismisses (inset → 0) — the composer must NOT follow it
      // down; the panel now occupies that space.
      mockMobileKeyboard.keyboardInset = 0;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
    });

    it("drops the composer in one step on a no-refocus close (no exit glide)", async () => {
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      // The keyboard is up at the panel height when the swap opens (realistic).
      mockMobileKeyboard.keyboardInset = 340;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Panel closes via outside tap / Escape: no editable is focused and the
      // keyboard stays gone. The freeze is removed in ONE step — the sheet's
      // own exit slide is the only motion, the composer never glides.
      mockEmojiSwap.open = false;
      mockEmojiSwap.height = 340;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
    });

    it("releases the freeze the moment the swap closes on refocus — the live global owns the return", () => {
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      // The keyboard is up at the panel height when the swap opens (realistic).
      mockMobileKeyboard.keyboardInset = 340;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // The keyboard returns: the user taps the editor — an editable grabs
      // focus and the swap closes. The freeze is removed in ONE step; from
      // here the live global geometry (which the keyboard module tracks every
      // frame) rides the composer up with the rising keyboard.
      (container.querySelector("input") as HTMLInputElement).focus();
      mockEmojiSwap.open = false;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

      // Later keyboard reports never touch the local override: the global
      // variable positions the composer now.
      mockMobileKeyboard.keyboardInset = 340;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      mockMobileKeyboard.viewportHeight = window.innerHeight - 341;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
    });

    it("never steers the local freeze from keyboard reports (no overshoot rides)", async () => {
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      // The keyboard is up at the panel height when the swap opens (realistic).
      mockMobileKeyboard.keyboardInset = 340;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Keyboard return begins (tap on the editor): the freeze is already gone
      // — the local override never rides keyboard reports, overshoot or not.
      (container.querySelector("input") as HTMLInputElement).focus();
      mockEmojiSwap.open = false;
      mockMobileKeyboard.keyboardInset = 0;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

      // A transient report HIGHER than the sheet was (overshoot): the local
      // override stays gone.
      mockMobileKeyboard.keyboardInset = 350;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

      // And it stays gone — nothing to hand off, no glide.
      mockMobileKeyboard.keyboardInset = 350;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 349;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      await waitFor(() => expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe(""));
    });

    it("touch: never touches window.scrollTo — the document is unscrollable while a chat is open", async () => {
      mockMobileKeyboard.isTouch = true;
      // The browser "panned" the document (iOS keyboard-open reveal).
      Object.defineProperty(window, "scrollY", { value: 40, configurable: true });
      Object.defineProperty(window, "scrollX", { value: 0, configurable: true });
      const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      mockMobileKeyboard.isTouch = true;
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      mockMobileKeyboard.keyboardInset = 340;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      const rerenderPanel = () =>
        rerender(
          <div className="chat-panel">
            <MessageComposer
              draft=""
              setDraft={vi.fn()}
              isSending={false}
              onSend={vi.fn()}
              composerRef={{ current: null }}
            />
            <input data-testid="kb-return" />
          </div>,
        );
      // Open, close, refocus: the composer must never fight the document —
      // scrollTo stays untouched throughout (the open chat is unscrollable via
      // body.messenger-mobile-chat-active, so Safari cannot pan it at all).
      await waitFor(() => expect(scrollSpy).not.toHaveBeenCalled());
      (container.querySelector("input") as HTMLInputElement).focus();
      mockEmojiSwap.open = false;
      mockMobileKeyboard.keyboardInset = 0;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      await waitFor(() => expect(scrollSpy).not.toHaveBeenCalled());

      mockMobileKeyboard.keyboardInset = 340;
      rerenderPanel();
      mockMobileKeyboard.viewportHeight = window.innerHeight - 341;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      await waitFor(() => expect(scrollSpy).not.toHaveBeenCalled());
    });

    it("touch: opening a sheet over a real keyboard freezes the lift at the keyboard height (layout effect, no flash)", () => {
      mockMobileKeyboard.isTouch = true;
      mockMobileKeyboard.keyboardInset = 340; // the keyboard is really up
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      mockEmojiSwap.height = 340;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      // The swap opens (the mock's toggle is a no-op — flip it like the real
      // hook does): the layout effect freezes the lift before paint, so the
      // composer never flashes at the bottom for a frame.
      mockEmojiSwap.open = true;
      rerender(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
        </div>,
      );
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      // The engine then reports the keyboard closed early (Firefox), with the
      // keyboard still visually collapsing — the frozen lift holds the
      // composer, no drop to the bottom.
      mockMobileKeyboard.keyboardInset = 0;
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
    });

    it("firefox-style: the window itself collapses with the keyboard (vv-delta 0) — the slot measures the shrink, close releases in one step", async () => {
      mockMobileKeyboard.isTouch = true;
      mockMobileKeyboard.keyboardInset = 0; // Firefox: vv moves with innerHeight, delta stays 0
      mockMobileKeyboard.viewportHeight = window.innerHeight; // vv === innerHeight, always
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      const rerenderPanel = () =>
        rerender(
          <div className="chat-panel">
            <MessageComposer
              draft=""
              setDraft={vi.fn()}
              isSending={false}
              onSend={vi.fn()}
              composerRef={{ current: null }}
            />
            <input data-testid="kb-return" />
          </div>,
        );
      // The keyboard is up: the window has collapsed by the keyboard's height
      // (baseline was captured at the full 768 during the mount render, the
      // effect's max-tracker never shrinks back).
      Object.defineProperty(window, "innerHeight", { value: window.innerHeight - 340, configurable: true });
      mockMobileKeyboard.viewportHeight = window.innerHeight; // still vv === innerHeight
      // Tap the attach trigger: nothing is written synchronously — the freeze
      // lands with the swap open (layout effect), measured from the 340
      // shrink (the vv-delta reads 0 in this engine).
        fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      // The swap's open flip lands after the tap (the mock's toggle is a
      // no-op — flip it like the real hook does, then let the open branch run).
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 400; // provisional guess must NOT win over the real 340 measurement
      rerenderPanel();
      // The window is still collapsed at the flip — the composer sits at its
      // keyboard-up seat (window bottom = keyboard top), no lift needed yet.
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      // The window grows back as the keyboard dismisses: the lift compensates
      // exactly (lift = innerHeight − sheetTop), the composer never moves.
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
      mockMobileKeyboard.viewportHeight = 768; // vv === innerHeight, always
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      // The sheet is sized to the REAL keyboard (340) and pinned by its TOP
      // edge (baseline 768 − 340 = 428) — the collapsing window can't carry it
      // over the messages or fly it up on return.
      const sheet = screen.getByTestId("attach-sheet");
      expect(sheet).toHaveStyle({ height: "340px", top: "428px" });

      // Return to the input: the swap closes and the freeze is removed in ONE
      // step. Resizes afterwards never re-lift: the sheet session is over and
      // the live global owns the composer.
      (container.querySelector("input") as HTMLInputElement).focus();
      mockEmojiSwap.open = false;
      mockMobileKeyboard.keyboardInset = 0;
      Object.defineProperty(window, "innerHeight", { value: 591, configurable: true });
      mockMobileKeyboard.viewportHeight = 591;
      rerenderPanel();
      fireEvent(window, new Event("resize"));
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      Object.defineProperty(window, "innerHeight", { value: 428, configurable: true });
      mockMobileKeyboard.viewportHeight = 428;
      fireEvent(window, new Event("resize"));
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      // And a later window growth (keyboard dismissed by an outside tap etc.)
      // must NOT re-lift the composer: the session is over (local 0).
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
      fireEvent(window, new Event("resize"));
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    });

    it("switch attach↔emoji keeps the composer lift (no drop to the bottom)", async () => {
      mockMobileKeyboard.isTouch = true;
      mockMobileKeyboard.keyboardInset = 0;
      mockMobileKeyboard.viewportHeight = window.innerHeight;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      const rerenderPanel = () =>
        rerender(
          <div className="chat-panel">
            <MessageComposer
              draft=""
              setDraft={vi.fn()}
              isSending={false}
              onSend={vi.fn()}
              composerRef={{ current: null }}
            />
            <input data-testid="kb-return" />
          </div>,
        );
      // Keyboard up: window collapsed by 340.
      Object.defineProperty(window, "innerHeight", { value: window.innerHeight - 340, configurable: true });
      mockMobileKeyboard.viewportHeight = window.innerHeight;
        fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 400;
      rerenderPanel();
      // Window grows back (keyboard dismissed) — composer held at the sheet top.
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
      mockMobileKeyboard.viewportHeight = 768;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Switch attach → emoji (same slot machinery, no keyboard): the lift
      // must stay put — the composer never drops to the bottom. The switch
      // tap reaches the attach sheet's document-level mousedown close as an
      // "outside tap" (the emoji trigger lives in the composer chrome, not in
      // the sheet) — fire the REAL mousedown first, exactly like on the
      // device, then the click.
      fireEvent.mouseDown(screen.getByTestId("swap-toggle"));
      fireEvent.click(screen.getByTestId("swap-toggle"));
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      // No glide may have been armed by the (now skipped) close — let any
      // pending rAF finish and re-check.
      await new Promise((r) => setTimeout(r, 320));
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Switch emoji → attach — same: a real mousedown on the paperclip must
      // not close the swap either.
      fireEvent.mouseDown(screen.getByRole("button", { name: "Прикрепить файл" }));
      fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      await new Promise((r) => setTimeout(r, 320));
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    });

    it("firefox-style: a resize while the sheet is OPEN never releases the lift (no composer drop on the second trigger)", async () => {
      mockMobileKeyboard.isTouch = true;
      mockMobileKeyboard.keyboardInset = 0; // Firefox: vv moves with innerHeight, delta stays 0
      mockMobileKeyboard.viewportHeight = window.innerHeight;
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      // The touch pin loop scrolls the document to 0 every frame while the
      // lift is held — jsdom doesn't implement scrollTo, stub it.
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      const rerenderPanel = () =>
        rerender(
          <div className="chat-panel">
            <MessageComposer
              draft=""
              setDraft={vi.fn()}
              isSending={false}
              onSend={vi.fn()}
              composerRef={{ current: null }}
            />
            <input data-testid="kb-return" />
          </div>,
        );
      // Keyboard up: window collapsed by 340, sheet opens over the slot.
      Object.defineProperty(window, "innerHeight", { value: window.innerHeight - 340, configurable: true });
      mockMobileKeyboard.viewportHeight = window.innerHeight;
        fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 400;
      rerenderPanel();
      // The window grows back as the keyboard dismisses — and a REAL resize
      // event lands while the sheet is still up. On the window-collapse engine
      // this used to arm the window-follow release, which then dropped the
      // composer under the still-open sheet ~LIFT_HOLD_FALLBACK_MS later —
      // exactly when the user taps the second trigger (attach↔emoji switch).
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
      mockMobileKeyboard.viewportHeight = 768;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      fireEvent(window, new Event("resize"));
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      // Longer than the follow's release deadline: the lift must SURVIVE —
      // the sheet session owns it, no keyboard is returning.
      await new Promise((r) => setTimeout(r, 950));
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      // The attach↔emoji switch stays seamless.
      fireEvent.mouseDown(screen.getByTestId("swap-toggle"));
      fireEvent.click(screen.getByTestId("swap-toggle"));
      fireEvent.mouseDown(screen.getByRole("button", { name: "Прикрепить файл" }));
      fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      await new Promise((r) => setTimeout(r, 320));
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    });

    it("constant-window: closing the swap releases the freeze immediately even while the keyboard is visibly rising", async () => {
      mockMobileKeyboard.isTouch = true;
      // The sheet opens over the (constant-window) keyboard at the sheet height.
      mockMobileKeyboard.keyboardInset = 340;
      mockMobileKeyboard.viewportHeight = window.innerHeight - 340;
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      const rerenderPanel = () =>
        rerender(
          <div className="chat-panel">
            <MessageComposer
              draft=""
              setDraft={vi.fn()}
              isSending={false}
              onSend={vi.fn()}
              composerRef={{ current: null }}
            />
            <input data-testid="kb-return" />
          </div>,
        );
        mockEmojiSwap.open = true;
      mockEmojiSwap.height = 340;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Return to typing: the editor grabs focus and the swap closes. The
      // freeze is removed in ONE step even though the live visual viewport
      // still shows the keyboard up (its events are late) — from here the
      // live global geometry owns the composer, no hold, no blink window.
      (container.querySelector("input") as HTMLInputElement).focus();
      mockEmojiSwap.open = false;
      mockMobileKeyboard.keyboardInset = 0;
      mockMobileKeyboard.viewportHeight = window.innerHeight;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

      Object.defineProperty(window, "visualViewport", {
        value: { height: window.innerHeight - 340, offsetTop: 0 },
        configurable: true,
      });
      try {
        await new Promise((r) => setTimeout(r, 150));
        rerenderPanel();
        expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

        // Late reports land at the keyboard height: the local override stays
        // gone throughout — the global variable positions the composer now.
        mockMobileKeyboard.keyboardInset = 340;
        rerenderPanel();
        expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
        mockMobileKeyboard.viewportHeight = window.innerHeight - 341;
        rerenderPanel();
        expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      } finally {
        delete (window as any).visualViewport;
      }
    });

    it("firefox-style: closing the swap releases the freeze even mid-collapse (no riding, no re-lift)", async () => {
      mockMobileKeyboard.isTouch = true;
      mockMobileKeyboard.keyboardInset = 0; // Firefox: vv moves with innerHeight, delta stays 0
      mockMobileKeyboard.viewportHeight = window.innerHeight;
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      const { container, rerender } = render(
        <div className="chat-panel">
          <MessageComposer
            draft=""
            setDraft={vi.fn()}
            isSending={false}
            onSend={vi.fn()}
            composerRef={{ current: null }}
          />
          <input data-testid="kb-return" />
        </div>,
      );
      const chatPanel = container.querySelector(".chat-panel") as HTMLElement;
      const rerenderPanel = () =>
        rerender(
          <div className="chat-panel">
            <MessageComposer
              draft=""
              setDraft={vi.fn()}
              isSending={false}
              onSend={vi.fn()}
              composerRef={{ current: null }}
            />
            <input data-testid="kb-return" />
          </div>,
        );
      // Sheet opens over the (window-collapse) keyboard: window collapsed by 340.
      Object.defineProperty(window, "innerHeight", { value: window.innerHeight - 340, configurable: true });
      mockMobileKeyboard.viewportHeight = window.innerHeight;
        fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
      mockEmojiSwap.open = true;
      mockEmojiSwap.height = 400;
      rerenderPanel();
      // Keyboard dismissed, window grown back — composer held at the sheet top.
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
      mockMobileKeyboard.viewportHeight = 768;
      rerenderPanel();
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Return: editor focused, swap closed. The freeze is removed in ONE
      // step even mid-collapse — collapse resizes never re-lift once the
      // sheet session is over.
      (container.querySelector("input") as HTMLInputElement).focus();
      mockEmojiSwap.open = false;
      Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
      mockMobileKeyboard.viewportHeight = 500;
      rerenderPanel();
      fireEvent(window, new Event("resize"));
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

      try {
        await new Promise((r) => setTimeout(r, 150));
        rerenderPanel();
        expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");

        // The collapse completes — still no lift: the session is over.
        Object.defineProperty(window, "innerHeight", { value: 428, configurable: true });
        mockMobileKeyboard.viewportHeight = 428;
        fireEvent(window, new Event("resize"));
        expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("");
      } finally {
        // Restore even if an assertion above fails, so a mid-test failure
        // can't pollute the tests that run after this one.
        Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
        mockMobileKeyboard.viewportHeight = 768;
      }
    });
  });

  describe("emoji picker", () => {
    it("inserts an emoji through the editor handle", async () => {
      const { setDraft } = setup();
      await userEvent.click(screen.getByTestId("insert-emoji"));
      await waitFor(() => expect(setDraft).toHaveBeenCalledWith("[e:test-emoji-id]"));
      expect(editorSpies.focusCalls.length).toBe(1);
    });

    it("inserts WITHOUT refocusing while the swap panel is open", async () => {
      mockEmojiSwap.open = true;
      setup();
      await userEvent.click(screen.getByTestId("insert-emoji"));
      expect(editorSpies.insertEmojiOpts).toEqual([{ focus: false }]);
      expect(editorSpies.focusCalls.length).toBe(0);
    });

    it("keeps the composer expanded while the swap panel is open", () => {
      mockEmojiSwap.open = true;
      setup();
      expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");
    });

    it("toggles the swap panel via the emoji trigger", async () => {
      setup();
      await userEvent.click(screen.getByTestId("swap-toggle"));
      expect(mockEmojiSwap.toggle).toHaveBeenCalled();
    });

    it("closes a re-tap while the sheet is still sliding out instead of reopening", () => {
      // The panel stays visible through its ~300ms exit slide while `open` is
      // already false; deciding on `open` alone reopened it, so the trigger read
      // as "does nothing" on a second press.
      mockEmojiSwap.open = false;
      mockEmojiSwap.isSheetVisible = () => true;
      mockEmojiSwap.toggle = vi.fn();
      mockEmojiSwap.closePanel = vi.fn();
      setup();

      fireEvent.click(screen.getByTestId("swap-toggle"));

      expect(mockEmojiSwap.closePanel).toHaveBeenCalled();
      expect(mockEmojiSwap.toggle).not.toHaveBeenCalled();
    });
  });

  describe("paste (Ctrl+V)", () => {
    function renderComposer(onAttachFiles: (files: File[]) => void) {
      render(
        <MessageComposer
          draft=""
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
          onAttachFiles={onAttachFiles}
        />,
      );
      return screen.getByPlaceholderText("Напиши сообщение...") as HTMLTextAreaElement;
    }

    it("makes the input inert while a voice draft owns the row", () => {
      // A recorded draft covers the composer; the text field underneath must be
      // unreachable — no click, no Tab focus (Telegram disables it the same way).
      render(
        <MessageComposer
          draft=""
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          onSendVoice={vi.fn()}
          composerRef={{ current: null }}
          onAttachFiles={vi.fn()}
        />,
      );

      const inputPill = document.querySelector(".composer-input-pill") as HTMLElement;
      expect(inputPill.hasAttribute("inert")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Открыть черновик" }));

      expect(inputPill.hasAttribute("inert")).toBe(true);
      expect(document.querySelector(".composer-attach-btn-wrap")?.hasAttribute("inert")).toBe(true);
    });

    it("forwards pasted files to onAttachFiles exactly once", () => {
      const onAttachFiles = vi.fn();
      const textarea = renderComposer(onAttachFiles);
      const file = new File(["png-data"], "photo.png", { type: "image/png" });

      fireEvent.paste(textarea, {
        clipboardData: {
          files: [file],
          items: [{ kind: "file", getAsFile: () => file }],
        },
      });

      expect(onAttachFiles).toHaveBeenCalledTimes(1);
      expect(onAttachFiles).toHaveBeenCalledWith([file]);
    });

    it("falls back to clipboardData.files when items carry no files", () => {
      const onAttachFiles = vi.fn();
      const textarea = renderComposer(onAttachFiles);
      const file = new File(["data"], "doc.txt", { type: "text/plain" });

      fireEvent.paste(textarea, {
        clipboardData: { files: [file], items: [{ kind: "string" }] },
      });

      expect(onAttachFiles).toHaveBeenCalledWith([file]);
    });

    it("lets plain text paste through untouched", () => {
      const onAttachFiles = vi.fn();
      const textarea = renderComposer(onAttachFiles);

      fireEvent.paste(textarea, {
        clipboardData: { files: [], items: [{ kind: "string" }] },
      });

      expect(onAttachFiles).not.toHaveBeenCalled();
    });
  });

  describe("reply banner", () => {
    it("caps a long reply preview to one ellipsized line with the author prefix", () => {
      const long = "Не удалось загрузить страницу. Возможно, приложение обновилось или соединение прервалось. ".repeat(4);
      const { container } = render(
        <MessageComposer
          draft=""
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
          replyToMessage={{ id: "m1", content: long, is_deleted: false } as any}
          replySenderLabel="Собеседник"
          onCancelReply={vi.fn()}
        />,
      );
      const banner = container.querySelector(".composer-reply-banner") as HTMLElement;
      expect(banner).toBeInTheDocument();
      // The author and the preview are separate flex children: the label is a
      // capped prefix, the preview carries the ellipsis (`min-width: 0` — a
      // nowrap flex child without it widened the whole composer).
      expect(banner.querySelector(".reply-label")).toHaveTextContent("Собеседник");
      const preview = banner.querySelector(".reply-text") as HTMLElement;
      expect(preview.textContent!.length).toBeLessThanOrEqual(121);
      expect(preview.textContent!.endsWith("…")).toBe(true);
      expect(banner.querySelector(".composer-reply-cancel")).toBeInTheDocument();
    });

    it("dismissing the reply keeps the composer focused (the X must not steal focus)", () => {
      const onCancelReply = vi.fn();
      render(
        <MessageComposer
          draft=""
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
          replyToMessage={{ id: "m1", content: "Привет", is_deleted: false } as any}
          replySenderLabel="Вы"
          onCancelReply={onCancelReply}
        />,
      );
      const cancel = screen.getByRole("button", { name: "Отменить ответ" }) as HTMLButtonElement;
      const textarea = screen.getByPlaceholderText("Напиши сообщение...") as HTMLTextAreaElement;
      textarea.focus();
      expect(document.activeElement).toBe(textarea);
      const focusBefore = editorSpies.focusCalls.length;
      // The X is a pressable button, but its mousedown default would focus the
      // button — blurring the editor and dismissing the keyboard on iOS (and
      // leaving a focus ring). The guard cancels that default.
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
      cancel.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(textarea);
      // The click still dismisses the reply, and the editor is re-focused in
      // the same gesture so the keyboard stays up.
      cancel.click();
      expect(onCancelReply).toHaveBeenCalledTimes(1);
      expect(editorSpies.focusCalls.length).toBeGreaterThan(focusBefore);
      expect(document.activeElement).toBe(textarea);
    });
  });

  describe("editing mode", () => {
    it("shows the edit banner and a save button", () => {
      render(
        <MessageComposer
          draft="[b]old[/b]"
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
          editingMessageId="m1"
          editingContent="[b]old[/b]"
          onCancelEdit={vi.fn()}
          onSaveEdit={vi.fn()}
        />,
      );
      expect(screen.getByText("Редактирование")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /save|сохранить/i })).toBeInTheDocument();
    });

    it("saves the edit with the new wire content", async () => {
      const onSaveEdit = vi.fn();
      render(
        <MessageComposer
          draft="[b]new[/b]"
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
          editingMessageId="m1"
          editingContent="[b]old[/b]"
          onSaveEdit={onSaveEdit}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /save|сохранить/i }));
      expect(onSaveEdit).toHaveBeenCalledWith("m1", "[b]new[/b]");
    });

    it("cancels the edit when the draft did not change", async () => {
      const onCancelEdit = vi.fn();
      render(
        <MessageComposer
          draft="[b]same[/b]"
          setDraft={vi.fn()}
          isSending={false}
          onSend={vi.fn()}
          composerRef={{ current: null }}
          editingMessageId="m1"
          editingContent="[b]same[/b]"
          onCancelEdit={onCancelEdit}
          onSaveEdit={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: /save|сохранить/i }));
      expect(onCancelEdit).toHaveBeenCalled();
    });
  });
});
