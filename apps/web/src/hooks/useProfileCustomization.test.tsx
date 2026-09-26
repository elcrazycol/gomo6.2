import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProfileCustomization } from "./useProfileCustomization";
import { PROFILE_CACHE_INVALIDATE_EVENT } from "@/utils/profileCacheEvents";

const mockGetProfileCustomization = vi.fn();

vi.mock("@/utils/profileCustomization", () => ({
  getProfileCustomization: (...args: unknown[]) => mockGetProfileCustomization(...args),
}));

const customization = (css: string) => ({
  username_css: css,
  profile_badge_text: null,
  profile_badge_css: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProfileCustomization.mockResolvedValue(customization("color: red"));
});

describe("useProfileCustomization", () => {
  it("loads the customization for the user", async () => {
    const { result } = renderHook(() => useProfileCustomization("user-1"));

    await waitFor(() => expect(result.current?.username_css).toBe("color: red"));
    expect(mockGetProfileCustomization).toHaveBeenCalledWith("user-1");
  });

  it("re-reads when the profile cache is invalidated", async () => {
    const { result } = renderHook(() => useProfileCustomization("user-1"));
    await waitFor(() => expect(mockGetProfileCustomization).toHaveBeenCalledTimes(1));

    // The studio published a new nickname colour.
    mockGetProfileCustomization.mockResolvedValue(customization("color: blue"));
    act(() => {
      window.dispatchEvent(new CustomEvent(PROFILE_CACHE_INVALIDATE_EVENT));
    });

    // The hook must pick it up without remounting.
    await waitFor(() => expect(result.current?.username_css).toBe("color: blue"));
    expect(mockGetProfileCustomization).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when disabled or without a user", () => {
    renderHook(() => useProfileCustomization("user-1", false));
    renderHook(() => useProfileCustomization(null));

    expect(mockGetProfileCustomization).not.toHaveBeenCalled();
  });
});
