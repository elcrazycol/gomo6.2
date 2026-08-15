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
}));

const makeDoc = (value: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

vi.mock("@/components/GomoRichEditor", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const mockEditor = { isActive: () => false };
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
    closePanel: vi.fn(),
  } as any,
}));

vi.mock("@/hooks/useEmojiKeyboardSwap", () => ({
  useEmojiKeyboardSwap: () => mockEmojiSwap,
}));

const { mockMobileKeyboard } = vi.hoisted(() => ({
  mockMobileKeyboard: { keyboardInset: 0 } as any,
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the collapsed pill with emoji and send buttons", () => {
    const { textarea, sendButton } = setup();
    expect(textarea).toBeInTheDocument();
    expect(sendButton).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Развернуть компоузер" })).toBeInTheDocument();
    // Collapsed: the attach button is hidden, the editor is one line.
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[22px]");
  });

  it("expands on focus: taller editor (paperclip waits for full mode)", () => {
    const { textarea } = setup();
    fireEvent.focus(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");
    // The paperclip only takes the ▢'s slot once the full composer opens.
    expect(screen.queryByRole("button", { name: "Прикрепить файл" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Развернуть компоузер" })).toBeInTheDocument();
  });

  it("collapses back to the pill on blur with an empty draft", () => {
    const { textarea } = setup();
    fireEvent.focus(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");

    fireEvent.blur(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[22px]");
  });

  it("does not collapse on blur when the draft is not empty", () => {
    const { textarea } = setup({ draft: "Hello" });
    fireEvent.focus(textarea);
    fireEvent.blur(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");
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
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");

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

    it("hands off to the real keyboard inset once it catches up on refocus close", async () => {
      mockEmojiSwap.open = true;
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
      expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px");

      // Panel closes while the keyboard rises back to the same height — the
      // composer must not drop (the local override keeps the panel height
      // until the real inset catches up).
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
      await waitFor(() => expect(chatPanel.style.getPropertyValue("--kb-inset")).toBe("340px"));
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
      expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");
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
