import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockRequest, mockGetToken, mockGetCSRFToken } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockGetToken: vi.fn(() => "token"),
  mockGetCSRFToken: vi.fn(() => "csrf"),
}));

vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    request: mockRequest,
    getToken: mockGetToken,
    getCSRFToken: mockGetCSRFToken,
  },
}));

import { useSpotifyAuthorPolling } from "./useSpotifyAuthorPolling";

// Initial poll fires after 3s, then every 10s.
const INITIAL_DELAY = 3000;
const INTERVAL = 10000;

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("useSpotifyAuthorPolling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetToken.mockReturnValue("token");
    mockGetCSRFToken.mockReturnValue("csrf");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not poll when there is no session", async () => {
    mockGetToken.mockReturnValue(null);
    mockGetCSRFToken.mockReturnValue(null);

    renderHook(() => useSpotifyAuthorPolling());
    await advance(INITIAL_DELAY + INTERVAL);

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("stops polling once the server reports nothing connected", async () => {
    mockRequest.mockResolvedValue({ is_playing: false, is_connected: false });

    renderHook(() => useSpotifyAuthorPolling());

    await advance(INITIAL_DELAY + 100);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Nothing connected — the interval ticks must be no-ops (no network spam).
    await advance(INTERVAL * 3);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while a track connection is active", async () => {
    mockRequest.mockResolvedValue({ is_playing: true, is_connected: true });

    renderHook(() => useSpotifyAuthorPolling());

    await advance(INITIAL_DELAY + 100);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    await advance(INTERVAL + 100);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("stops on the legacy 503 from an unconfigured backend", async () => {
    mockRequest.mockRejectedValue({ status: 503 });

    renderHook(() => useSpotifyAuthorPolling());

    await advance(INITIAL_DELAY + 100);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    await advance(INTERVAL * 3);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
