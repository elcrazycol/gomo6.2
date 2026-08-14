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
  composerRef?: RefObject<{ focus: () => void; insertText: (text: string) => void; insertEmoji: (data: unknown, opts?: { focus?: boolean }) => void } | null>;
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

  it("expands on focus: taller editor + attach button slides in", () => {
    const { textarea } = setup();
    fireEvent.focus(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");
    expect(screen.getByRole("button", { name: "Прикрепить файл" })).toBeInTheDocument();
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

  it("expands and collapses the full composer with the ▢ toggle", async () => {
    const { textarea } = setup({ draft: "Hello" });
    const toggle = screen.getByRole("button", { name: "Развернуть компоузер" });

    await userEvent.click(toggle);
    // Toolbar becomes visible and the editor grows.
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-show-toolbar", "true");
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-max-height", "max-h-[45vh] overflow-y-auto overscroll-contain");
    expect(editorSpies.toolbarVisibility).toContain(true);

    // Expanded composer never collapses back to the one-line pill.
    fireEvent.blur(textarea);
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-min-height", "min-h-[44px]");

    await userEvent.click(screen.getByRole("button", { name: "Свернуть компоузер" }));
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute("data-show-toolbar", "false");
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
