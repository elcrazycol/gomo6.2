import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  flushWallViews,
  getAnonymousViewerKey,
  registerWallPostView,
  usePostViewTracking,
} from "@/hooks/usePostViewTracking";

const ANON_KEY_STORAGE = "gomo6_anon_viewer_key";

type ObserveCallback = IntersectionObserverCallback;

/** Controllable IntersectionObserver for driving the hook's visibility events. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly callback: ObserveCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ObserveCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const TestCard = ({ postId }: { postId: string }) => {
  const ref = usePostViewTracking(postId);
  return (
    <div ref={ref} data-testid="card">
      {postId}
    </div>
  );
};

describe("usePostViewTracking", () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    window.localStorage.removeItem(ANON_KEY_STORAGE);
    vi.stubGlobal(
      "IntersectionObserver",
      MockIntersectionObserver as unknown as typeof IntersectionObserver
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // Leave no pending ids behind for the next test.
    flushWallViews();
  });

  it("reports the post as viewed once its card becomes visible", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<TestCard postId="post-visible-1" />);

    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeTruthy();
    expect(observer.observe).toHaveBeenCalledTimes(1);

    act(() => observer.trigger(true));
    flushWallViews();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/rpc/record_wall_views");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.post_ids).toEqual(["post-visible-1"]);
    expect(body.viewer_key).toBeTruthy();
  });

  it("does not observe when the post id is missing", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<TestCard postId="" />);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it("does not observe when tracking is disabled", () => {
    vi.stubGlobal("fetch", vi.fn());
    const DisabledCard = () => {
      const ref = usePostViewTracking("post-disabled-1", false);
      return <div ref={ref} data-testid="card" />;
    };
    render(<DisabledCard />);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it("never fires twice for the same post in one session", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<TestCard postId="post-session-1" />);
    const observer = MockIntersectionObserver.instances[0];
    // The card is seen, scrolled away and seen again.
    act(() => observer.trigger(true));
    act(() => observer.trigger(true));

    flushWallViews();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.post_ids).toEqual(["post-session-1"]);

    // Nothing left queued — a second flush must not fire another request.
    flushWallViews();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("wall view batching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    flushWallViews();
  });

  it("batches multiple posts into one request", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    registerWallPostView("post-batch-1");
    registerWallPostView("post-batch-2");
    registerWallPostView("post-batch-3");
    flushWallViews();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.post_ids).toEqual(["post-batch-1", "post-batch-2", "post-batch-3"]);
  });

  it("skips empty flushes", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    flushWallViews();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-flushes when the batch reaches the limit", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // 25 distinct posts cross the batch limit → immediate flush without a timer.
    for (let i = 0; i < 25; i++) {
      registerWallPostView(`post-batch-limit-${i}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.post_ids).toHaveLength(25);
  });
});

describe("getAnonymousViewerKey", () => {
  afterEach(() => {
    window.localStorage.removeItem(ANON_KEY_STORAGE);
  });

  it("returns a stable key persisted in localStorage", () => {
    const first = getAnonymousViewerKey();
    const second = getAnonymousViewerKey();
    expect(first).toBeTruthy();
    expect(first).toBe(second);
    expect(window.localStorage.getItem(ANON_KEY_STORAGE)).toBe(first);
  });
});
