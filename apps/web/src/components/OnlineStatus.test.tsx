import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OnlineStatus } from "./OnlineStatus";

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 часа назад",
}));

vi.mock("date-fns/locale", () => ({ ru: {} }));

vi.mock("@/utils/safeDate", () => ({
  safeDate: (d: string) => new Date(d),
}));

vi.mock("@/hooks/useRealtimeStatus", () => ({
  useUserRealtimeStatus: () => null,
}));

describe("OnlineStatus", () => {
  it("shows online indicator when isOnline is true", () => {
    render(<OnlineStatus userId="u1" isOnline />);
    expect(screen.getByText("в сети")).toBeInTheDocument();
  });

  it("shows green dot when online", () => {
    const { container } = render(<OnlineStatus userId="u1" isOnline />);
    expect(container.querySelector(".bg-green-500")).toBeInTheDocument();
  });

  it("shows last seen when offline with lastSeen", () => {
    render(<OnlineStatus userId="u1" isOnline={false} lastSeen="2025-01-01T00:00:00Z" />);
    expect(screen.getByText(/был\(а\) в сети/)).toBeInTheDocument();
  });

  it("hides text when showText is false for online", () => {
    render(<OnlineStatus userId="u1" isOnline showText={false} />);
    expect(screen.queryByText("в сети")).not.toBeInTheDocument();
  });

  it("hides text prefix when showText is false for last seen", () => {
    render(<OnlineStatus userId="u1" isOnline={false} lastSeen="2025-01-01T00:00:00Z" showText={false} />);
    expect(screen.getByText("2 часа назад")).toBeInTheDocument();
    expect(screen.queryByText(/был\(а\) в сети/)).not.toBeInTheDocument();
  });

  it("returns null when not online and no lastSeen", () => {
    const { container } = render(<OnlineStatus userId="u1" isOnline={false} lastSeen={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when no props", () => {
    const { container } = render(<OnlineStatus />);
    expect(container.innerHTML).toBe("");
  });

  it("applies custom className", () => {
    const { container } = render(<OnlineStatus userId="u1" isOnline className="custom-class" />);
    expect(container.querySelector(".custom-class")).toBeInTheDocument();
  });
});
