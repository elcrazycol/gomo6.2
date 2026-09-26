import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import React from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockToast, mockInvalidate } = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn() },
  mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() },
  mockInvalidate: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({
  api: { from: vi.fn(), auth: mockAuth },
}));
vi.mock("@/integrations/api/queryCache", () => ({ invalidateByPrefix: mockInvalidate }));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/utils/mediaUpload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/mediaUpload")>();
  return { ...actual, uploadAttachments: vi.fn(), uploadEditedDataUrl: vi.fn() };
});

// The раздел taxonomy comes from the backend — feed the picker a fixed tree.
const SECTIONS = [
  {
    id: "sec-1",
    slug: "games",
    name: "Игры",
    description: "Игры и всё вокруг",
    icon: "gamepad-2",
    is_nsfw: false,
    sort_order: 10,
    subsections: [
      { id: "sub-1", section_id: "sec-1", slug: "pc", name: "ПК", description: null, sort_order: 10 },
      { id: "sub-2", section_id: "sec-1", slug: "consoles", name: "Консоли", description: null, sort_order: 20 },
    ],
  },
  {
    id: "sec-2",
    slug: "news",
    name: "Новости",
    description: null,
    icon: "newspaper",
    is_nsfw: false,
    sort_order: 20,
    subsections: [],
  },
];
vi.mock("@/hooks/useThreadSections", () => ({
  useThreadSections: () => ({ sections: SECTIONS, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/components/GomoRichEditor", () => {
  const MockEditor = React.forwardRef(function MockEditor({ onChange, placeholder }: any, ref: React.Ref<unknown>) {
    const [value, setValue] = React.useState("");
    const valueRef = React.useRef("");
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
    );
  });
  return { GomoRichEditor: MockEditor };
});
vi.mock("@/components/EmojiPicker", () => ({ EmojiPicker: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

let Component: any;

describe("CreateThread (global topic)", () => {
  beforeAll(async () => {
    const mod = await import("./CreateThread");
    Component = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: "token-abc" } }, error: null });
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/rpc/create_thread")) {
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ data: { id: "topic-1" } }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: null }) });
    });
  });

  it("opens the раздел picker first and reveals подразделы", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText("Выберите раздел")).toBeTruthy());

    await user.click(screen.getByText("Игры"));
    expect(screen.getByText("ПК")).toBeTruthy();
    expect(screen.getByText("Консоли")).toBeTruthy();
    expect(screen.getByText("Продолжить без подраздела")).toBeTruthy();
  });

  it("advances straight to the composer for a раздел without подразделы", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText("Выберите раздел")).toBeTruthy());
    await user.click(screen.getByText("Новости"));

    await waitFor(() => expect(screen.getByPlaceholderText("Заголовок темы")).toBeTruthy());
    expect(screen.getByTestId("topic-composer")).toBeTruthy();
  });

  it("publishes a topic with section and subsection", async () => {
    const user = userEvent.setup();
    render(<Component />);
    await waitFor(() => expect(screen.getByText("Выберите раздел")).toBeTruthy());
    await user.click(screen.getByText("Игры"));
    await user.click(screen.getByText("ПК"));

    await waitFor(() => expect(screen.getByPlaceholderText("Заголовок темы")).toBeTruthy());
    await user.type(screen.getByPlaceholderText("Заголовок темы"), "Моя тема");
    await user.type(screen.getByTestId("composer-editor"), "Текст темы");

    const publish = screen.getByRole("button", { name: "Опубликовать" });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    await user.click(publish);

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(([url]) => String(url).startsWith("/api/rpc/create_thread"));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.section_id).toBe("sec-1");
      expect(body.subsection_id).toBe("sub-1");
      expect(body.title).toBe("Моя тема");
      expect(body.content).toBe("Текст темы");
    });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/thread/topic-1", { replace: true }));
    expect(localStorage.getItem("gomo6:topic-draft:new")).toBeNull();
  });
});
