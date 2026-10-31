import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuestUnlockOverlay } from "./QuestUnlockOverlay";

const mockNavigate = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

type Handler = (message: { data?: unknown }) => void;
let handlers: Handler[] = [];

vi.mock("@/services/eventManager", () => ({
  eventManager: {
    on: (_type: string, handler: Handler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((h) => h !== handler);
      };
    },
  },
}));

const PROGRESS = {
  user_id: "u1",
  drops: 0,
  unclaimed_count: 1,
  quests: [
    {
      group_key: "qs_avatar",
      title_key: "achievements.qs_avatar.title",
      category: "profile",
      track: "first_steps",
      icon: "smile",
      sort_order: 1,
      current_level: 1,
      progress_current: 1,
      levels: [
        {
          level: 1,
          threshold: 1,
          name_key: "achievements.qs_avatar.1.name",
          description_key: "achievements.qs_avatar.1.description",
          rewards: [{ kind: "drops", amount: 20 }],
          completed: true,
          claimed: false,
          can_claim: true,
        },
      ],
    },
  ],
  chests: [],
};

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ success: true, data }),
    text: () => Promise.resolve(JSON.stringify({ success: true, data })),
  };
}

beforeEach(() => {
  handlers = [];
  mockNavigate.mockReset();
  mockFetch.mockReset();
  mockFetch.mockImplementation(() => Promise.resolve(ok(PROGRESS)));
});

function emitUnlock() {
  act(() => {
    for (const h of handlers) {
      h({ data: { id: "n1", type: "achievement_unlock", params: { group_key: "qs_avatar", level: 1 } } });
    }
  });
}

describe("QuestUnlockOverlay", () => {
  it("shows a centered card with the quest name and reward", async () => {
    render(<QuestUnlockOverlay />);
    emitUnlock();

    expect(await screen.findByText("Лицо")).toBeInTheDocument();
    expect(screen.getByText("Квест выполнен")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("navigates to the quest page on button click", async () => {
    render(<QuestUnlockOverlay />);
    emitUnlock();

    const btn = await screen.findByText("Забрать награду");
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith("/achievements/u1", {
      state: { focusQuest: "qs_avatar" },
    });
  });

  it("docks bottom-center instead of covering the screen", async () => {
    render(<QuestUnlockOverlay />);
    emitUnlock();

    const card = await screen.findByRole("status");
    const dock = card.parentElement;
    expect(dock?.className).toMatch(/bottom-6/);
    expect(dock?.className).toMatch(/justify-center/);
  });

  it("ignores other notification types", () => {
    render(<QuestUnlockOverlay />);
    act(() => {
      for (const h of handlers) h({ data: { id: "n2", type: "like" } });
    });
    expect(screen.queryByText("Квест выполнен")).not.toBeInTheDocument();
  });
});
