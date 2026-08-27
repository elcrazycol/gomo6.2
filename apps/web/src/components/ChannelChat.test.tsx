import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ChannelChat from "./ChannelChat";

const wsMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(m: unknown) => void>>();
  return {
    subs: [] as string[],
    unsubs: [] as string[],
    on: (type: string, fn: (m: unknown) => void) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(fn);
      return () => {
        set?.delete(fn);
      };
    },
    emit: (type: string, data: unknown) => {
      handlers.get(type)?.forEach((fn) =>
        fn({ type, data, timestamp: Date.now() })
      );
    },
    reset() {
      handlers.clear();
      this.subs.length = 0;
      this.unsubs.length = 0;
    },
  };
});

vi.mock("@/services/websocket", () => ({
  wsService: {
    subscribe: (room: string) => wsMock.subs.push(room),
    unsubscribe: (room: string) => wsMock.unsubs.push(room),
    on: wsMock.on,
  },
}));

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    getToken: vi.fn().mockReturnValue(null),
    getCSRFToken: vi.fn().mockReturnValue("csrf-token"),
  },
}));

vi.mock("@/i18n/dateLocale", () => ({
  useDateLocale: () => undefined,
}));

const CH = "10000000-0000-0000-0000-000000000001";
const ME = "20000000-0000-0000-0000-000000000002";

function jsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ success: true, data }),
  };
}

beforeEach(() => {
  wsMock.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads history, subscribes the room and renders oldest→newest", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse([
      { id: 1, channel_id: CH, user_id: ME, username: "me", avatar_url: null, content: "первое", created_at: "2026-08-20T10:00:00Z" },
      { id: 2, channel_id: CH, user_id: "u9", username: "bob", avatar_url: null, content: "второе", created_at: "2026-08-20T10:01:00Z" },
    ])
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<ChannelChat channelId={CH} currentUserId={ME} />);

  await waitFor(() => {
    expect(screen.getByText("первое")).toBeInTheDocument();
  });
  expect(screen.getByText("второе")).toBeInTheDocument();
  expect(wsMock.subs).toContain(`channel_${CH}`);
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/v1/gomosubchat/channels/${CH}/messages?limit=50`,
    { credentials: "include" }
  );
});

it("unsubscribes the room when the component leaves", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
  vi.stubGlobal("fetch", fetchMock);

  const { unmount } = render(<ChannelChat channelId={CH} currentUserId={ME} />);
  await waitFor(() => expect(screen.getByPlaceholderText(/Написать/i)).toBeInTheDocument());
  unmount();

  expect(wsMock.unsubs).toContain(`channel_${CH}`);
});

it("posts through REST and appends the returned message", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([]))
    .mockResolvedValueOnce(
      jsonResponse({ id: 5, channel_id: CH, user_id: ME, username: "me", avatar_url: null, content: "мой месседж", created_at: "2026-08-20T11:00:00Z" })
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<ChannelChat channelId={CH} currentUserId={ME} />);
  const input = await screen.findByPlaceholderText(/Написать/i);

  fireEvent.change(input, { target: { value: "мой месседж" } });
  fireEvent.submit(input.closest("form")!);

  await waitFor(() => expect(screen.getByText("мой месседж")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenLastCalledWith(
    `/api/v1/gomosubchat/channels/${CH}/messages`,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ content: "мой месседж" }),
    })
  );
  // Draft must be cleared after a successful send.
  expect((input as HTMLInputElement).value).toBe("");
  // CSRF header present (protected route).
  const [, init] = fetchMock.mock.calls[1];
  expect(init.headers["X-CSRF-Token"]).toBe("csrf-token");
});

it("appends realtime events and dedups the optimistic duplicate", async () => {
  const base = { id: 5, channel_id: CH, user_id: "u7", username: "rita", avatar_url: null, content: "по WS", created_at: "2026-08-20T12:00:00Z" };
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
  vi.stubGlobal("fetch", fetchMock);

  render(<ChannelChat channelId={CH} currentUserId={ME} />);
  await screen.findByPlaceholderText(/Написать/i);

  act(() => {
    wsMock.emit("new_channel_message", base);
    wsMock.emit("new_channel_message", base); // duplicate event
  });

  await waitFor(() => expect(screen.getByText("по WS")).toBeInTheDocument());
  // Exactly one instance despite the double emit.
  expect(screen.getAllByText("по WS")).toHaveLength(1);

  // Events of another channel must be ignored.
  act(() => {
    wsMock.emit("new_channel_message", { ...base, id: 6, channel_id: "99999999-9999-9999-9999-999999999999", content: "чужой канал" });
  });
  expect(screen.queryByText("чужой канал")).not.toBeInTheDocument();
});

it("renders a read-only notice without access instead of the composer", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    (() => {
      return { ok: false, status: 403, json: async () => ({ success: false, error: "No access" }) };
    })()
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<ChannelChat channelId={CH} currentUserId={ME} />);

  await waitFor(() => expect(screen.getByText(/Нет доступа/i)).toBeInTheDocument());
  expect(screen.queryByPlaceholderText(/Написать/i)).not.toBeInTheDocument();
});

it("marks deleted messages with a placeholder and blanks the text", async () => {
  const msg = { id: 3, channel_id: CH, user_id: ME, username: "me", avatar_url: null, content: "привет", created_at: "2026-08-20T09:00:00Z" };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([msg]))
    .mockResolvedValueOnce(
      jsonResponse({ ...msg, content: "", deleted_at: "2026-08-27T00:00:00Z" })
    );
  vi.stubGlobal("fetch", fetchMock);

  render(<ChannelChat channelId={CH} currentUserId={ME} canDeleteOthers={false} />);

  expect(await screen.findByText("привет")).toBeInTheDocument();

  // Own message → hover actions show delete button.
  fireEvent.mouseEnter(screen.getByText("привет").closest("div.group")!);
  const delBtn = document.querySelector('button[title="Удалить"]') as HTMLButtonElement | null;
  expect(delBtn).not.toBeNull();

  await act(async () => {
    fireEvent.click(delBtn!);
  });

  await waitFor(() => {
    expect(screen.getByText(/Сообщение удалено/i)).toBeInTheDocument();
  });
  expect(screen.queryByText("привет")).not.toBeInTheDocument();
});
