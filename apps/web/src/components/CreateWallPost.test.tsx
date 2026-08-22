import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { toast } from "sonner";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Records editor-handle calls from the GomoRichEditor mock (module factory is
// hoisted, so shared spies must live in vi.hoisted).
const editorSpies = vi.hoisted(() => ({
  insertEmojiOpts: [] as any[],
  focusCalls: [] as boolean[],
}));

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

const mockUploadAttachments = vi.fn();
vi.mock("@/utils/mediaUpload", () => ({
  uploadAttachments: (...args: any[]) => mockUploadAttachments(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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
          legacyContent,
          maxHeightClassName,
        }: any,
        ref: any
      ) => {
        if (ref) {
          ref.current = {
            focus: () => {
              editorSpies.focusCalls.push(true);
            },
            insertText: (text: string) => {
              onChange?.({
                json: contentJson || {},
                text: (legacyContent || "") + text,
              });
            },
            insertEmoji: (
              data: { emojiId: string; packId: string; url: string; name: string },
              opts?: { focus?: boolean }
            ) => {
              editorSpies.insertEmojiOpts.push(opts ?? null);
              onChange?.({
                json: contentJson || {},
                text: (legacyContent || "") + `[e:${data.emojiId}]`,
              });
            },
          };
        }
        return (
          <div
            data-testid="gomo-rich-editor"
            data-placeholder={placeholder}
            data-reset-key={resetKey}
            data-max-height-class={maxHeightClassName}
          >
            <textarea
              data-testid="rich-editor-textarea"
              placeholder={placeholder}
              value={legacyContent || ""}
              onChange={(e) =>
                onChange?.({ json: contentJson || {}, text: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit?.();
                }
              }}
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
        onClick={() => onEmojiSelect({ emojiId: "test-emoji-id", packId: "test-pack", url: "/test.webp", name: "test" })}
      >
        😀
      </button>
      {children}
    </div>
  ),
}));

vi.mock("@/components/Lightbox", () => ({
  Lightbox: ({ items, initialIndex, onClose }: any) => (
    <div data-testid="image-gallery" data-images={items?.length} data-index={initialIndex}>
      <button data-testid="gallery-close" onClick={onClose}>
        Close Gallery
      </button>
    </div>
  ),
}));

vi.mock("@/components/RichContentRenderer", () => ({
  RichContentRenderer: () => <div data-testid="rich-content-renderer">Preview</div>,
}));

// ─── Query Builder Mock ──────────────────────────────────────────────────────

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;

  p.select = (_sel?: string, _opts?: any) => p;
  p.eq = (_col?: string, _val?: any) => p;
  p.order = (_col?: string, _opts?: any) => p;
  p.single = () => p;
  p.maybeSingle = () => p;

  p.insert = (_row?: any) => {
    const insertP = Promise.resolve(resolveValue) as any;
    insertP.select = () => insertP;
    insertP.single = () => insertP;
    return insertP;
  };

  p.update = (_row?: any) => {
    const updateP = Promise.resolve(resolveValue) as any;
    updateP.eq = () => updateP;
    updateP.select = () => updateP;
    updateP.single = () => updateP;
    return updateP;
  };

  return p;
}

function setupApiMocks(resolveValue?: any) {
  mockFrom.mockReturnValue(
    makeChain(resolveValue ?? { data: { id: "default-id" }, error: null })
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps = {
  profileUserId: "profile-user-1",
  currentUserId: "current-user",
  onCancel: vi.fn(),
};

const defaultCreatedPost = {
  id: "new-post-id",
  user_id: "profile-user-1",
  author_id: "current-user",
  title: "Hello world",
  content: "Hello world",
  content_json: null,
  image_url: null,
  attachments: null,
  created_at: "2025-01-15T10:00:00Z",
  updated_at: "2025-01-15T10:00:00Z",
  author: { username: "testuser", is_anonymous: false, avatar_url: null },
};

const mockAttachment = {
  url: "wall://pic.jpg",
  type: "image",
  mime: "image/jpeg",
  name: "pic.jpg",
  size: 1024,
};

let Component: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateWallPost", () => {
  beforeAll(async () => {
    const mod = await import("./CreateWallPost");
    Component = mod.CreateWallPost;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    editorSpies.insertEmojiOpts.length = 0;
    editorSpies.focusCalls.length = 0;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders as an overlay in create mode with header, close and publish button", () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    expect(screen.getByText("Новая запись на стене")).toBeInTheDocument();
    expect(screen.getByLabelText("Закрыть")).toBeInTheDocument();
    expect(screen.getByText("Опубликовать")).toBeInTheDocument();
  });

  it("caps the editor height so long posts scroll inside instead of growing", () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    // Long posts must scroll INSIDE the editor (capped height + internal
    // scroll) rather than growing the overlay and fighting the mobile keyboard.
    expect(screen.getByTestId("gomo-rich-editor")).toHaveAttribute(
      "data-max-height-class",
      "max-h-full"
    );
  });

  it("renders in edit mode with pre-filled content and save button", () => {
    setupApiMocks();
    render(
      <Component
        {...defaultProps}
        editingPost={defaultCreatedPost}
        onPostUpdated={vi.fn()}
      />
    );

    expect(screen.getByText("Редактирование записи")).toBeInTheDocument();
    expect(screen.getByText("Сохранить")).toBeInTheDocument();

    const textarea = screen.getByTestId("rich-editor-textarea");
    expect(textarea).toHaveValue("Hello world");
  });

  it("submit button is disabled when content is empty and no attachments", () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    expect(screen.getByText("Опубликовать")).toBeDisabled();
  });

  it("submit button is disabled while submitting", async () => {
    mockFrom.mockReturnValue(
      (() => {
        const p = new Promise<never>(() => {}) as any;
        p.select = () => p;
        p.eq = () => p;
        p.order = () => p;
        p.single = () => p;
        p.insert = () => {
          const ip = new Promise<never>(() => {}) as any;
          ip.select = () => ip;
          ip.single = () => ip;
          return ip;
        };
        p.update = () => {
          const up = new Promise<never>(() => {}) as any;
          up.eq = () => up;
          up.select = () => up;
          up.single = () => up;
          return up;
        };
        return p;
      })()
    );

    render(<Component {...defaultProps} />);

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Test post");

    const submitBtn = screen.getByText("Опубликовать");
    expect(submitBtn).not.toBeDisabled();
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Опубликовать")).toBeDisabled();
    });
  });

  it("submit button is enabled when content is present", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Some content");

    expect(screen.getByText("Опубликовать")).not.toBeDisabled();
  });

  it("submit button is enabled when only attachments are present", async () => {
    setupApiMocks();
    mockUploadAttachments.mockResolvedValue([mockAttachment]);
    render(<Component {...defaultProps} />);

    expect(screen.getByText("Опубликовать")).toBeDisabled();

    const file = new File(["x"], "pic.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByTestId("composer-file-input"), file);

    await waitFor(() => {
      expect(screen.getByText("Опубликовать")).not.toBeDisabled();
    });
  });

  it("creates a post successfully and calls onPostCreated", async () => {
    setupApiMocks({ data: defaultCreatedPost, error: null });
    const onPostCreated = vi.fn();
    const onBeforeCreate = vi.fn();

    render(
      <Component
        {...defaultProps}
        onPostCreated={onPostCreated}
        onBeforeCreate={onBeforeCreate}
      />
    );

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Hello world");
    await userEvent.click(screen.getByText("Опубликовать"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Пост опубликован");
    });

    expect(onPostCreated).toHaveBeenCalledWith(defaultCreatedPost);
    expect(onBeforeCreate).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("rich-editor-textarea")).toHaveValue("");
    });
  });

  it("edits a post successfully and calls onPostUpdated", async () => {
    setupApiMocks({ data: defaultCreatedPost, error: null });
    const onPostUpdated = vi.fn();

    render(
      <Component
        {...defaultProps}
        editingPost={defaultCreatedPost}
        onPostUpdated={onPostUpdated}
      />
    );

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Updated content");
    await userEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Пост обновлен");
    });

    expect(onPostUpdated).toHaveBeenCalledWith(defaultCreatedPost);
  });

  it("shows error toast when create fails", async () => {
    mockFrom.mockReturnValue({
      ...makeChain(null),
      insert: () => ({
        select: () => ({
          single: () => Promise.reject(new Error("DB error")),
        }),
      }),
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<Component {...defaultProps} />);

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Failing post");
    await userEvent.click(screen.getByText("Опубликовать"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Ошибка публикации поста");
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("shows error toast when edit fails", async () => {
    mockFrom.mockReturnValue({
      ...makeChain(null),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.reject(new Error("Update error")),
            }),
          }),
        }),
      }),
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <Component
        {...defaultProps}
        editingPost={defaultCreatedPost}
        onPostUpdated={vi.fn()}
      />
    );

    await userEvent.click(screen.getByText("Сохранить"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Ошибка обновления поста");
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("slides the panel down and calls onCancel when the close button is clicked", async () => {
    setupApiMocks();
    const onCancel = vi.fn();
    render(<Component {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByLabelText("Закрыть"));

    // The panel starts its slide-down animation before the overlay unmounts.
    expect(screen.getByTestId("wall-post-composer").className).toContain("translate-y-full");
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("calls onCancel when Escape is pressed", async () => {
    setupApiMocks();
    const onCancel = vi.fn();
    render(<Component {...defaultProps} onCancel={onCancel} />);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("locks page scroll while open and restores it on unmount", () => {
    setupApiMocks();
    const { unmount } = render(<Component {...defaultProps} />);

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");

    unmount();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overscrollBehavior).toBe("");
  });

  it("toggles between the editor and live preview", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Hello");

    await userEvent.click(screen.getByText("Предпросмотр"));
    expect(screen.getByTestId("rich-content-renderer")).toBeInTheDocument();
    expect(screen.queryByTestId("rich-editor-textarea")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Редактировать"));
    expect(screen.getByTestId("rich-editor-textarea")).toBeInTheDocument();
  });

  it("restores an autosaved draft and shows the draft badge", async () => {
    setupApiMocks();
    localStorage.setItem(
      "gomo6:wall-draft:profile-user-1",
      JSON.stringify({ content: "Draft text", contentJson: null, attachments: [] })
    );

    render(<Component {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("rich-editor-textarea")).toHaveValue("Draft text");
    });
    expect(screen.getByText("черновик")).toBeInTheDocument();
  });

  it("clears the draft after a successful publish", async () => {
    setupApiMocks({ data: defaultCreatedPost, error: null });
    localStorage.setItem(
      "gomo6:wall-draft:profile-user-1",
      JSON.stringify({ content: "Draft text", contentJson: null, attachments: [] })
    );

    render(<Component {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("rich-editor-textarea")).toHaveValue("Draft text");
    });
    await userEvent.click(screen.getByText("Опубликовать"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Пост опубликован");
    });
    expect(localStorage.getItem("gomo6:wall-draft:profile-user-1")).toBeNull();
  });

  it("calls onBeforeCreate before API request", async () => {
    setupApiMocks({ data: defaultCreatedPost, error: null });
    const onBeforeCreate = vi.fn(() => "temp-id");

    render(<Component {...defaultProps} onBeforeCreate={onBeforeCreate} />);

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Test");
    await userEvent.click(screen.getByText("Опубликовать"));

    await waitFor(() => {
      expect(onBeforeCreate).toHaveBeenCalled();
    });

    expect(onBeforeCreate).toHaveReturnedWith("temp-id");
  });

  it("submits when Enter is pressed in the editor", async () => {
    setupApiMocks({ data: defaultCreatedPost, error: null });
    const onPostCreated = vi.fn();

    render(<Component {...defaultProps} onPostCreated={onPostCreated} />);

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Enter submit{Enter}");

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Пост опубликован");
    });

    expect(onPostCreated).toHaveBeenCalled();
  });

  it("re-populates form when editingPost changes", async () => {
    setupApiMocks();
    const { rerender } = render(
      <Component
        {...defaultProps}
        editingPost={undefined}
        onPostUpdated={vi.fn()}
      />
    );

    expect(screen.getByTestId("rich-editor-textarea")).toHaveValue("");

    rerender(
      <Component
        {...defaultProps}
        editingPost={{
          ...defaultCreatedPost,
          content: "Updated content",
          attachments: [
            {
              url: "img.jpg",
              type: "image",
              mime: "image/jpeg",
              name: "img.jpg",
              size: 2048,
            },
          ],
        }}
        onPostUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("rich-editor-textarea")).toHaveValue(
        "Updated content"
      );
    });

    expect(screen.getByAltText("img.jpg")).toBeInTheDocument();
  });

  it("inserts emoji into editor when emoji is selected", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    const emojiBtn = screen.getByTestId("insert-emoji");
    await userEvent.click(emojiBtn);

    await waitFor(() => {
      const textarea = screen.getByTestId("rich-editor-textarea");
      expect(textarea).toHaveValue("[e:test-emoji-id]");
    });
  });

  it("opens the keyboard-swap panel on toggle and closes via onSwapClose", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    const picker = screen.getByTestId("emoji-picker");
    expect(picker).toHaveAttribute("data-swap-open", "false");

    await userEvent.click(screen.getByTestId("swap-toggle"));
    expect(picker).toHaveAttribute("data-swap-open", "true");

    await userEvent.click(screen.getByTestId("swap-close"));
    expect(picker).toHaveAttribute("data-swap-open", "false");
  });

  it("inserts emoji WITHOUT refocusing while the swap panel is open", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    // Open the keyboard-replacement panel.
    await userEvent.click(screen.getByTestId("swap-toggle"));
    expect(screen.getByTestId("emoji-picker")).toHaveAttribute("data-swap-open", "true");

    await userEvent.click(screen.getByTestId("insert-emoji"));

    await waitFor(() => {
      expect(screen.getByTestId("rich-editor-textarea")).toHaveValue("[e:test-emoji-id]");
    });
    // No focus() → keyboard stays hidden, caret preserved.
    expect(editorSpies.insertEmojiOpts).toEqual([{ focus: false }]);
    expect(editorSpies.focusCalls.length).toBe(0);
  });

  it("refocuses the editor (keyboard returns) when the swap panel is toggled closed", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    await userEvent.click(screen.getByTestId("swap-toggle"));
    await userEvent.click(screen.getByTestId("swap-toggle"));

    expect(screen.getByTestId("emoji-picker")).toHaveAttribute("data-swap-open", "false");
    expect(editorSpies.focusCalls.length).toBe(1);
  });

  describe("drag & drop", () => {
    it("shows the drop hint while a file drag hovers the composer", () => {
      setupApiMocks();
      render(<Component {...defaultProps} />);
      const card = screen.getByTestId("wall-post-composer");

      fireEvent.dragEnter(card, { dataTransfer: { files: [], types: ["Files"] } });

      expect(screen.getByText("Отпустите, чтобы прикрепить")).toBeInTheDocument();
    });

    it("attaches files dropped anywhere on the composer", async () => {
      setupApiMocks();
      mockUploadAttachments.mockResolvedValue([mockAttachment]);
      render(<Component {...defaultProps} />);
      const card = screen.getByTestId("wall-post-composer");
      const file = new File(["x"], "drop.jpg", { type: "image/jpeg" });

      fireEvent.drop(card, {
        dataTransfer: { files: [file], types: ["Files"] },
      });

      await waitFor(() => {
        expect(mockUploadAttachments).toHaveBeenCalledWith([file], "wall");
      });
      expect(screen.getByText("Опубликовать")).not.toBeDisabled();
    });
  });
});
