import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { clearQueryCache, getCached } from "@/integrations/api/queryCache";
import { useCachedQuery } from "./useCachedQuery";

describe("useCachedQuery", () => {
  beforeEach(() => {
    clearQueryCache();
  });

  it("fetches on a cold cache", async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const { result } = renderHook(() => useCachedQuery("uk1", fetcher));

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
  });

  it("renders a warm value on the first render", async () => {
    await getCached("uk2", async () => ({ v: 9 }));
    const fetcher = vi.fn().mockResolvedValue({ v: 10 });

    const { result } = renderHook(() => useCachedQuery("uk2", fetcher, { ttlMs: 1000 }));

    expect(result.current.data).toEqual({ v: 9 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("updates in place when a background revalidation lands", async () => {
    await getCached("uk3", async () => ({ v: 1 }), { ttlMs: 1, staleTtlMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const fetcher = vi.fn().mockResolvedValue({ v: 2 });
    const { result } = renderHook(() =>
      useCachedQuery("uk3", fetcher, { ttlMs: 1, staleTtlMs: 60_000 }),
    );

    // The stale value is served immediately…
    expect(result.current.data).toEqual({ v: 1 });
    // …then replaced once the revalidation lands.
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }));
  });

  it("surfaces a cold-start error without data", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCachedQuery("uk4", fetcher));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.data).toBeUndefined();
  });

  it("does not read or fetch while disabled", () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const { result } = renderHook(() => useCachedQuery("uk5", fetcher, { enabled: false }));

    expect(result.current.data).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refetches after the cache is cleared", async () => {
    await getCached("uk6", async () => ({ v: 1 }));
    const fetcher = vi.fn().mockResolvedValue({ v: 2 });

    const { result } = renderHook(() => useCachedQuery("uk6", fetcher, { ttlMs: 60_000 }));
    expect(result.current.data).toEqual({ v: 1 });

    act(() => clearQueryCache());

    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
