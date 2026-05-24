import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { toast } from "sonner";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
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
        }: any,
        ref: any
      ) => {
        if (ref) {
          ref.current = {
            focus: vi.fn(),
            insertText: (text: string) => {
              onChange?.({
                json: contentJson || {},
                text: (legacyContent || "") + text,
              });
            },
          };
        }
        return (
          <div
            data-testid="gomo-rich-editor"
            data-placeholder={placeholder}
            data-reset-key={resetKey}
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

vi.mock("@/components/ProfileAttachmentUpload", () => ({
  ProfileAttachmentUpload: ({ value, onChange }: any) => (
    <div data-testid="profile-attachment-upload">
      <span>{value.length} attachments</span>
      <button
        data-testid="add-attachment"
        onClick={() =>
          onChange([
            ...value,
            {
              url: "test.jpg",
              type: "image",
              mime: "image/jpeg",
              name: "test.jpg",
              size: 1024,
            },
          ])
        }
      >
        Add Image
      </button>
      <button data-testid="clear-attachments" onClick={() => onChange([])}>
        Clear
      </button>
    </div>
  ),
}));

vi.mock("@/components/EmojiPicker", () => ({
  EmojiPicker: ({ onEmojiSelect, children }: any) => (
    <div data-testid="emoji-picker">
      <button
        data-testid="insert-emoji"
        onClick={() => onEmojiSelect("😀")}
      >
        😀
      </button>
      {children}
    </div>
  ),
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

let Component: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateWallPost", () => {
  beforeAll(async () => {
    const mod = await import("./CreateWallPost");
    Component = mod.CreateWallPost;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders in create mode with correct title and submit button", () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    expect(screen.getByText("Новая запись на стене")).toBeInTheDocument();
    expect(screen.getByText("Опубликовать")).toBeInTheDocument();
    expect(screen.getByText("Отмена")).toBeInTheDocument();
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
      expect(screen.getByText("Публикуем")).toBeInTheDocument();
    });
    expect(screen.getByText("Публикуем")).toBeDisabled();
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
    render(<Component {...defaultProps} />);

    expect(screen.getByText("Опубликовать")).toBeDisabled();
    await userEvent.click(screen.getByTestId("add-attachment"));

    expect(screen.getByText("Опубликовать")).not.toBeDisabled();
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

  it("shows character count", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    expect(screen.getByText("0 симв.")).toBeInTheDocument();

    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "Hello");

    expect(screen.getByText("5 симв.")).toBeInTheDocument();
  });

  it("shows attachment count", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    expect(screen.getByText("0 влож.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("add-attachment"));

    expect(screen.getByText("1 влож.")).toBeInTheDocument();
  });

  it("shows image count when images are attached", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    expect(screen.queryByText("1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("add-attachment"));

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });

  it("calls onCancel when cancel button is clicked", async () => {
    setupApiMocks();
    const onCancel = vi.fn();
    render(<Component {...defaultProps} onCancel={onCancel} />);

    await userEvent.click(screen.getByText("Отмена"));

    expect(onCancel).toHaveBeenCalled();
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

    expect(screen.getByText("1 влож.")).toBeInTheDocument();
  });

  it("inserts emoji into editor when emoji is selected", async () => {
    setupApiMocks();
    render(<Component {...defaultProps} />);

    const emojiBtn = screen.getByTestId("insert-emoji");
    await userEvent.click(emojiBtn);

    await waitFor(() => {
      const textarea = screen.getByTestId("rich-editor-textarea");
      expect(textarea).toHaveValue("😀");
    });
  });
});
