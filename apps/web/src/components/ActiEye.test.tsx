import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActiEye, type ActiEyeSummary } from "./ActiEye";

const apiMock = vi.hoisted(() => ({
  getToken: vi.fn().mockReturnValue("token"),
  getCSRFToken: vi.fn().mockReturnValue("csrf"),
}));

vi.mock("@/integrations/api/client", () => ({
  apiClient: apiMock,
}));

const summary: ActiEyeSummary = {
  posts: 48,
  comments: 56,
  likes: 123,
  active_days: 5,
  current_streak: 5,
  best_streak: 9,
  days: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    active: i >= 25,
  })),
  seed: 42,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getToken.mockReturnValue("token");
  apiMock.getCSRFToken.mockReturnValue("csrf");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: summary }),
    })
  );
});

it("renders a plain orange circle without a session", () => {
  apiMock.getToken.mockReturnValue(null);
  apiMock.getCSRFToken.mockReturnValue(null);

  render(<ActiEye />);

  const button = screen.getByRole("button", { name: "Активность" });
  expect(button.querySelector("[style*='radial-gradient']")).toBeNull();
  expect(button.querySelector(".from-orange-400")).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("fetches the summary and renders the activity gradient", async () => {
  render(<ActiEye />);

  const button = await screen.findByRole("button", { name: "Активность" });
  await waitFor(() => {
    expect(button.querySelector("[style*='radial-gradient']")).not.toBeNull();
  });
  expect(fetch).toHaveBeenCalledWith("/api/v1/actieye", expect.objectContaining({ credentials: "include" }));
});

it("opens the activity panel with the streak road on click", async () => {
  render(<ActiEye />);

  const button = await screen.findByRole("button", { name: "Активность" });
  fireEvent.click(button);

  const dialog = await screen.findByRole("dialog");
  expect(dialog).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument(); // current streak
  expect(screen.getByText("Лучшая серия: 9")).toBeInTheDocument();
  // One circle per day of the window: 5 emerald (visited) + 25 gray (missed)
  const circles = dialog.querySelectorAll("[data-date^='2026-08']");
  expect(circles.length).toBe(30);
  expect(dialog.querySelectorAll("[fill='rgb(52 211 153)']").length).toBe(5); // visited
  expect(dialog.querySelectorAll("[fill='rgb(148 163 184)']").length).toBe(25); // missed
  expect(dialog.querySelector(".overflow-x-auto")).not.toBeNull();
  // 30 circles → 29 wavy connectors (the X icon's strokes live outside the road svg)
  expect(dialog.querySelectorAll(".overflow-x-auto svg path").length).toBe(29);
});

it("closes the panel via the close button", async () => {
  render(<ActiEye />);

  const button = await screen.findByRole("button", { name: "Активность" });
  fireEvent.click(button);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("shows an empty-streak hint when there are no active days", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ...summary, days: Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, active: false })) } }),
    })
  );

  render(<ActiEye />);

  fireEvent.click(await screen.findByRole("button", { name: "Активность" }));
  expect(await screen.findByText(/Пока нет серии заходов/)).toBeInTheDocument();
});

it("falls back to the orange circle when the summary has no activity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ...summary, posts: 0, comments: 0, likes: 0, active_days: 0 } }),
    })
  );

  render(<ActiEye />);

  const button = await screen.findByRole("button", { name: "Активность" });
  await waitFor(() => {
    expect(button.querySelector("[style*='radial-gradient']")).toBeNull();
  });
  expect(button.querySelector(".from-orange-400")).not.toBeNull();
});

/** Average RGB brightness of the first gradient stop — higher = more vivid. */
function firstStopBrightness(button: HTMLElement): number {
  const bg = button.querySelector("[style*='radial-gradient']")?.getAttribute("style") ?? "";
  const m = bg.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\)/);
  if (!m) throw new Error("no rgb stop in gradient");
  return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
}

it("dims the gradient for a low-activity account", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ...summary, posts: 1, comments: 1, likes: 1, active_days: 1 } }),
    })
  );
  render(<ActiEye />);
  const button = await screen.findByRole("button", { name: "Активность" });
  await waitFor(() => expect(firstStopBrightness(button)).toBeLessThan(120));
});

it("vivids the gradient for a very active account", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { ...summary, posts: 500, comments: 400, likes: 900, active_days: 200 },
      }),
    })
  );
  render(<ActiEye />);
  const button = await screen.findByRole("button", { name: "Активность" });
  await waitFor(() => expect(firstStopBrightness(button)).toBeGreaterThan(150));
});

