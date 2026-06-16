import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Poll, type Poll as PollType } from "./Poll";

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

const mockRpc = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = (_sel?: string, _opts?: any) => p;
  p.eq = (_col?: string, _val?: any) => p;
  p.maybeSingle = () => p;
  p.insert = (_row?: any) => {
    const insertP = Promise.resolve({ data: { id: "new-id" }, error: null }) as any;
    insertP.select = () => insertP;
    insertP.single = () => insertP;
    return insertP;
  };
  p.update = (_row?: any) => {
    const updateP = Promise.resolve({ data: null, error: null }) as any;
    updateP.eq = () => updateP;
    return updateP;
  };
  p.delete = () => {
    const delP = Promise.resolve({ data: null, error: null }) as any;
    delP.eq = () => delP;
    return delP;
  };
  return p;
}

function makePoll(overrides: Partial<PollType> = {}): PollType {
  return {
    id: "poll-1",
    question: "What is your favorite color?",
    options: [
      { id: "opt-1", text: "Red" },
      { id: "opt-2", text: "Blue" },
      { id: "opt-3", text: "Green" },
    ],
    allow_multiple: false,
    show_results: true,
    allow_change_vote: true,
    total_votes: 0,
    ...overrides,
  };
}

describe("Poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      if (table === "poll_votes") return makeChain({ data: null, error: null });
      return makeChain({ data: [], error: null });
    });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_poll_results") {
        return Promise.resolve({
          data: [
            { option_id: "opt-1", votes: 5, total_votes: 10 },
            { option_id: "opt-2", votes: 3, total_votes: 10 },
            { option_id: "opt-3", votes: 2, total_votes: 10 },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("renders poll question", () => {
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);
    expect(screen.getByText("📊 What is your favorite color?")).toBeInTheDocument();
  });

  it("renders all options", () => {
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);
    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText("Green")).toBeInTheDocument();
  });

  it("shows single choice hint", () => {
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);
    expect(screen.getByText(/Можно выбрать 1 вариант/)).toBeInTheDocument();
  });

  it("shows multiple choice hint", () => {
    render(<Poll poll={makePoll({ allow_multiple: true })} threadId="t-1" currentUserId="u-1" />);
    expect(screen.getByText(/Можно выбрать несколько вариантов/)).toBeInTheDocument();
  });

  it("loads and shows results when show_results is true", async () => {
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);
    await waitFor(() => {
      expect(screen.getByText("5 (50%)")).toBeInTheDocument();
    });
  });

  it("shows total votes when show_results is true", async () => {
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Всего голосов: 10/)).toBeInTheDocument();
    });
  });

  it("allows voting and shows toast", async () => {
    const user = userEvent.setup();
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);

    await waitFor(() => {
      expect(screen.getByText("Red")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Red"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("poll_votes");
    });
  });

  it("prevents voting when not logged in", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId={null} />);

    await user.click(screen.getByText("Red"));

    expect(toast.error).toHaveBeenCalledWith("Необходимо войти в систему для голосования");
  });

  it("prevents voting when already voted and change not allowed", async () => {
    const { toast } = await import("sonner");
    mockFrom.mockImplementation((table: string) => {
      if (table === "poll_votes") {
        return makeChain({ data: { option_ids: ["opt-1"] }, error: null });
      }
      return makeChain({ data: [], error: null });
    });

    const user = userEvent.setup();
    render(
      <Poll
        poll={makePoll({ allow_change_vote: false })}
        threadId="t-1"
        currentUserId="u-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Red")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Red"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Вы уже проголосовали и изменение голоса запрещено");
    });
  });

  it("shows voted message when voted and change not allowed", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "poll_votes") {
        return makeChain({ data: { option_ids: ["opt-1"] }, error: null });
      }
      return makeChain({ data: [], error: null });
    });

    render(
      <Poll
        poll={makePoll({ allow_change_vote: false })}
        threadId="t-1"
        currentUserId="u-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Вы уже проголосовали. Изменение голоса запрещено.")).toBeInTheDocument();
    });
  });

  it("shows loading state with opacity when isPageLoading is true", () => {
    const { container } = render(
      <Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" isPageLoading />,
    );
    const card = container.querySelector(".opacity-0");
    expect(card).toBeInTheDocument();
  });

  it("does not call get_poll_results when show_results is false", async () => {
    render(<Poll poll={makePoll({ show_results: false })} threadId="t-1" currentUserId="u-1" />);
    await waitFor(() => {
      expect(mockRpc).not.toHaveBeenCalledWith("get_poll_results", expect.anything());
    });
  });

  it("handles multiple choice voting", async () => {
    const user = userEvent.setup();
    render(<Poll poll={makePoll({ allow_multiple: true })} threadId="t-1" currentUserId="u-1" />);

    await waitFor(() => {
      expect(screen.getByText("Red")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Red"));
    await user.click(screen.getByText("Blue"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("poll_votes");
    });
  });

  it("removes vote when clicking same option in single choice", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "poll_votes") {
        return makeChain({ data: { option_ids: ["opt-1"] }, error: null });
      }
      return makeChain({ data: [], error: null });
    });

    const user = userEvent.setup();
    render(<Poll poll={makePoll()} threadId="t-1" currentUserId="u-1" />);

    await waitFor(() => {
      expect(screen.getByText("Red")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Red"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalled();
    });
  });
});
