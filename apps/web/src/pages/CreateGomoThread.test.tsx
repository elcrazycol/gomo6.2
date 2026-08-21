import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import React from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockToast, mockUploadAttachments, mockInvalidate } = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn(), getUser: vi.fn() },
  mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  mockUploadAttachments: vi.fn(),
  mockInvalidate: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: { from: (...args: unknown[]) => mockFrom(...args), auth: mockAuth },
}));
vi.mock("@/integrations/api/client", () => ({
  apiClient: { getToken: vi.fn(() => "token-abc"), getCSRFToken: vi.fn(() => "csrf-xyz") },
}));
vi.mock("@/integrations/api/queryCache", () => ({ invalidateByPrefix: mockInvalidate }));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/utils/mediaUpload", () => ({ uploadAttachments: mockUploadAttachments }));

// GomoRichEditor pulls in tiptap + emoji context — swap for a plain textarea
// that reports the same onChange contract ({ json, text }).
vi.mock("@/components/GomoRichEditor", () => {
  const MockEditor = React.forwardRef(function MockEditor(
    { onChange, placeholder, legacyContent }: any,
    ref: React.Ref<HTMLTextAreaElement>
  ) {
    return (
      <div>
        <textarea
          ref={ref}
          data-testid="composer-editor"
          placeholder={placeholder}
          defaultValue={legacyContent || ""}
          onChange={(e) => onChange({ json: { type: "doc", content: [] }, text: e.target.value })}
        />
      </div>
    );
  });
  return { GomoRichEditor: MockEditor };
});
vi.mock("@/components/EmojiPicker", () => ({ EmojiPicker: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/RichContentRenderer", () => ({
  RichContentRenderer: () => <div data-testid="rich-preview">rich content</div>,
}));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));

const mockNavigate = vi.fn();
const mockParams: Record<string, string | undefined> = { slug: "test", channelSlug: undefined };
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const board = {
  id: "board-1",
  slug: "test",
  name: "Test Sub",
  description: "desc",
  gomosub_tags: ["anime", "games"],
};

function chainable(resolveValue: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: vi.fn().mockResolvedValue({ data: resolveValue, error: null }),
  };
  return chain;
}

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) });
}

function setupFetchRoutes() {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/rpc/create_thread")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { id: "thread-1" } }) });
    }
    if (url.startsWith("/api/v1/channels")) {
      return jsonResponse([]);
    }
    return jsonResponse(null);
  });
}

let Component: any;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CreateGomoThread (composer)", () => {
  beforeAll(async () => {
    const mod = await import("./CreateGomoThread");
    Component = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.slug = "test";
    mockParams.channelSlug = undefined;
    localStorage.clear();
    mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: "token-abc" } }, error: null });
    mockFrom.mockImplementation((table: string) => chainable(table === "boards" ? board : null));
    setupFetchRoutes();
  });

  it("renders the composer with header, title and editor", async () => {
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    expect(screen.getByPlaceholderText("Заголовок")).toBeTruthy();
    expect(screen.getByPlaceholderText("Текст записи…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Опубликовать" })).toBeTruthy();
    // Tag chips from the board
    expect(screen.getByText("#anime")).toBeTruthy();
    expect(screen.getByText("#games")).toBeTruthy();
  });

  it("publishes via the RPC endpoint and navigates to the new post", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());

    const publish = screen.getByRole("button", { name: "Опубликовать" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByPlaceholderText("Заголовок"), "Hello world");
    await user.type(screen.getByPlaceholderText("Текст записи…"), "Body text here");
    expect((publish as HTMLButtonElement).disabled).toBe(false);

    await user.click(publish);

    await waitFor(() => {
      const createCall = mockFetch.mock.calls.find(([url]) => String(url).startsWith("/api/rpc/create_thread"));
      expect(createCall).toBeTruthy();
      const body = JSON.parse((createCall![1] as RequestInit).body as string);
      expect(body.title).toBe("Hello world");
      expect(body.content).toBe("Body text here");
      expect(body.board_id).toBe("board-1");
    });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Запись опубликована"));
    expect(mockNavigate).toHaveBeenCalledWith("/g/test/thread/thread-1");
    expect(mockInvalidate).toHaveBeenCalled();
    expect(localStorage.getItem("gomo6:composer-draft:board-1")).toBeNull();
  });

  it("restores an autosaved draft and marks it as such", async () => {
    localStorage.setItem(
      "gomo6:composer-draft:board-1",
      JSON.stringify({ title: "Draft title", content: "Draft body", contentJson: { type: "doc" }, attachments: [] })
    );
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    expect((screen.getByPlaceholderText("Заголовок") as HTMLInputElement).value).toBe("Draft title");
    expect((screen.getByPlaceholderText("Текст записи…") as HTMLTextAreaElement).value).toBe("Draft body");
    expect(screen.getByText("черновик")).toBeTruthy();
  });

  it("toggles the live preview", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    await user.type(screen.getByPlaceholderText("Заголовок"), "Preview me");
    await user.type(screen.getByPlaceholderText("Текст записи…"), "Some body");

    await user.click(screen.getByRole("button", { name: /Предпросмотр/ }));
    expect(screen.queryByPlaceholderText("Текст записи…")).toBeNull();
    expect(screen.getByText("Preview me")).toBeTruthy();
    expect(screen.getByTestId("rich-preview")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Редактировать/ }));
    expect(screen.getByPlaceholderText("Текст записи…")).toBeTruthy();
  });

  it("focuses the editor when clicking dead space in the pane", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    const editor = screen.getByTestId("composer-editor");
    expect(document.activeElement).not.toBe(editor);
    // Click the pane below the editor (the editor's parent div) — not the
    // textarea itself.
    const pane = editor.closest(".flex-1") as HTMLElement;
    expect(pane).toBeTruthy();
    await user.click(pane);
    expect(document.activeElement).toBe(editor);
  });

  it("closes back via the X button", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
