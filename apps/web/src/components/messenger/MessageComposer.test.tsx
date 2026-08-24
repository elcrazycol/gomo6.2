import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { MessageComposer } from "./MessageComposer";
import type { RefObject } from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const editorSpies = vi.hoisted(() => ({
  insertEmojiOpts: [] as any[],
  focusCalls: [] as boolean[],
  toolbarVisibility: [] as boolean[],
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
      void refocus;
    }),
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
  composerRef?: RefObject<{ focus: () => void; insertText: (text: string) => void; insertEmoji: (data: unknown, opts?: { focus?: boolean }) => void; getEditor: () => null } | null>;
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
    mockEmojiSwap.open = false;
    mockEmojiSwap.isTouch = false;
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
    expect(screen.getByRole("button", { name: "Развернуть компоузер" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("attach-sheet")).not.toBeInTheDocument();
  });

  it("touch: the paperclip opens the attach sheet in the keyboard slot (no native picker)", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("attach-sheet")).toHaveClass("is-closing");
    expect(mockEmojiSwap.closePanel).toHaveBeenCalledWith(false);
  });

  it("touch: the paperclip switches the open slot from the emoji panel to the attach sheet", () => {
    mockMobileKeyboard.isTouch = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Развернуть компоузер" }));
    mockEmojiSwap.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    expect(screen.getByTestId("attach-sheet")).toBeInTheDocument();
    // The emoji picker is no longer the active sheet — the swap stays up,
    // only the slot's content switched.
    expect(screen.getByTestId("emoji-picker")).toHaveAttribute("data-swap-open", "false");
  });

  it("keyboard slot: lifts by the full visual slot (URL bar included) and holds the lift while the keyboard returns", async () => {
    mockEmojiSwap.height = 300;
    mockMobileKeyboard.keyboardInset = 0;
    // The keyboard was up with the iOS URL bar expanded: the full slot delta
    // (innerHeight − visualViewport.height) exceeds the keyboard's own height.
    mockMobileKeyboard.viewportHeight = window.innerHeight - 360; // delta = 360
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
    const panel = container.querySelector(".chat-panel") as HTMLElement;
    const textarea = screen.getByPlaceholderText("Напиши сообщение...") as HTMLTextAreaElement;
    // A state-changing poke forces a re-render so the lift effect re-runs with
    // the mutated mock values (each fireEvent flushes effects).
    const poke = () => {
      const expand = screen.queryByRole("button", { name: "Развернуть компоузер" });
      const collapse = screen.queryByRole("button", { name: "Свернуть компоузер" });
      fireEvent.click((expand ?? collapse)!);
    };
    // Open the sheet: the lift glides up to the FULL slot (360), not the
    // keyboard height (300) — otherwise the panel would get less space than
    // the keyboard and the composer would sit a hair low. The glide (instead
    // of an instant jump) is what stops the "composer teleports" jerk on open.
    mockEmojiSwap.open = true;
    poke();
    await waitFor(() => expect(panel.style.getPropertyValue("--kb-inset")).toBe("360px"));
    // Close with the keyboard returning (tap on the editor): the global
    // --kb-inset still reports 0, so releasing would drop the composer to the
    // bottom for a frame before the keyboard rises — the lift is held.
    textarea.focus();
    mockEmojiSwap.open = false;
    mockMobileKeyboard.keyboardInset = 0;
    poke();
    expect(panel.style.getPropertyValue("--kb-inset")).toBe("360px");
    // The keyboard is back at its full height — the live global caught up with
    // the held lift. First report: the composer rides it (no snap). A second
    // report at the same inset means the keyboard settled — the override is
    // dropped (the global equals the local, nothing moves).
    mockMobileKeyboard.keyboardInset = 360;
    poke();
    expect(panel.style.getPropertyValue("--kb-inset")).toBe("360px");
    mockMobileKeyboard.viewportHeight = window.innerHeight - 359;
    poke();
    expect(panel.style.getPropertyValue("--kb-inset")).toBe("");
  });

  it("keeps the full input height regardless of focus (paperclip waits for full mode)", () => {
    const { textarea } = setup();
    fireEvent.focus(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");
    // The paperclip only takes the ▢'s slot once the full composer opens.
    expect(screen.queryByRole("button", { name: "Прикрепить файл" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Развернуть компоузер" })).toBeInTheDocument();
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

  it("send button is disabled when isSending is true", () => {
    const { sendButton } = setup({ draft: "Hello", isSending: true });
    expect(sendButton).toBeDisabled();
  });

  it("sends via the send button", async () => {
    const { sendButton, onSend } = setup({ draft: "Hello" });
    await userEvent.click(sendButton);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
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

  it("full composer: toolbar panel spans full width, ▢ moves up, paperclip appears", async () => {
    const { textarea } = setup({ draft: "Hello" });
    const toggle = screen.getByRole("button", { name: "Развернуть компоузер" });

    await userEvent.click(toggle);
    // The formatting panel (external toolbar) appears above the input pill.
    expect(screen.getByTestId("external-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("external-toolbar")).toHaveAttribute("data-editor", "yes");
    // The ▢ moved to the panel's left edge (now a close button)…
    expect(screen.getByRole("button", { name: "Свернуть компоузер" })).toBeInTheDocument();
    // …and the paperclip takes its old bottom slot.
    expect(screen.getByRole("button", { name: "Прикрепить файл" })).toBeInTheDocument();
    // The toolbar is rendered outside the editor; the editor grows taller.
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-show-toolbar", "false");
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-max-height", "max-h-[45vh] overflow-y-auto overscroll-contain");

    // Expanded composer never collapses back to the one-line pill.
    fireEvent.blur(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[20px]");

    // Closing via the panel's ▢: the paperclip leaves and the ▢ returns.
    await userEvent.click(screen.getByRole("button", { name: "Свернуть компоузер" }));
    await waitFor(() => expect(screen.queryByTestId("external-toolbar")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Прикрепить файл" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Развернуть компоузер" })).toBeInTheDocument();
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

    it("glides the composer down with the panel's exit on a no-refocus close", async () => {
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
      // keyboard stays gone. The composer must NOT teleport to the bottom —
      // it is still lifted right after the close...
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
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // ...and glides down, releasing the lift once the exit slide finishes.
      await waitFor(() => expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe(""));
    });

    it("holds the lift until the keyboard has fully returned (editable refocused), then releases seamlessly", () => {
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
      // focus. The live global --kb-inset still reports 0 (visual-viewport
      // events lag the rising keyboard by a couple of frames) — releasing now
      // would drop the composer to the bottom for a frame, then pop it back.
      // The lift is HELD: the composer stays put while the keyboard slides up.
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
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // The keyboard is back at its full height — the live global has caught
      // up with the held lift. First report: the composer rides it (no snap).
      // A second report at the same inset means the keyboard settled — the
      // override is dropped (the global equals the local, nothing moves).
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
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");
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
