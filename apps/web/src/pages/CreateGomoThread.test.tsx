import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import React from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockToast, mockUploadAttachments, mockInvalidate } = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn(), getUser: vi.fn() },
  mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() },
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
  apiClient: { getToken: vi.fn(() => "token-abc"), getCSRFToken: vi.fn(() => "csrf-xyz"), rawRequest: vi.fn() },
}));
vi.mock("@/integrations/api/queryCache", () => ({ invalidateByPrefix: mockInvalidate }));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/utils/mediaUpload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/mediaUpload")>();
  return { ...actual, uploadAttachments: mockUploadAttachments, uploadEditedDataUrl: vi.fn() };
});

// GomoRichEditor pulls in tiptap + emoji context — swap for a textarea that
// reports the same onChange contract ({ json, text }) and exposes a minimal
// handle (getEditor/getJSON) the RichComposer publish path needs.
vi.mock("@/components/GomoRichEditor", () => {
  const MockEditor = React.forwardRef(function MockEditor(
    { onChange, placeholder, contentJson }: any,
    ref: React.Ref<unknown>
  ) {
    const [value, setValue] = React.useState<string>("");
    React.useEffect(() => {
      // Reflect a restored document the first time one arrives.
      const doc = contentJson as { content?: Array<{ content?: Array<{ text?: string }> }> } | null;
      const text = doc?.content?.[0]?.content?.[0]?.text;
      if (typeof text === "string" && text.length > 0) setValue(text);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const valueRef = React.useRef(value);
    valueRef.current = value;
    React.useImperativeHandle(ref, () => ({
      focus: () => {},
      insertText: () => {},
      insertEmoji: () => {},
      getEditor: () => ({
        isDestroyed: false,
        view: { dom: document.createElement("div") },
        getJSON: () =>
          valueRef.current
            ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: valueRef.current }] }] }
            : { type: "doc", content: [] },
      }),
    }));
    return (
      <div>
        <textarea
          data-testid="composer-editor"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange({
              json: e.target.value
                ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: e.target.value }] }] }
                : { type: "doc", content: [] },
              text: e.target.value,
            });
          }}
        />
      </div>
    );
  });
  return { GomoRichEditor: MockEditor };
});
vi.mock("@/components/EmojiPicker", () => ({ EmojiPicker: ({ children }: any) => <>{children}</> }));
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
  mockFetch.mockImplementation((url: string) => {
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

  it("renders the composer with header, title, editor and tag chips", async () => {
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    expect(screen.getByPlaceholderText("Заголовок")).toBeTruthy();
    expect(screen.getByPlaceholderText("Текст записи…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Опубликовать" })).toBeTruthy();
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
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));

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
    expect(mockNavigate).toHaveBeenCalledWith("/g/test", { replace: true });
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
    expect(screen.getByText("черновик")).toBeTruthy();
  });

  it("closes back via the X button", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText(/g\/test/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(-1));
  });
});
