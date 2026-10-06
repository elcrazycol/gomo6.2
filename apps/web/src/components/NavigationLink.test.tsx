import { forwardRef, type ReactNode } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { NavigationLink } from "./NavigationLink";

const mocks = vi.hoisted(() => ({
  prefetchChunk: vi.fn(),
  prefetchData: vi.fn(),
  saveData: false,
}));

vi.mock("@/lib/routeChunks", () => ({ prefetchRouteChunk: mocks.prefetchChunk }));
vi.mock("@/lib/routeData", () => ({
  prefetchRouteData: mocks.prefetchData,
  shouldPrefetch: () => !mocks.saveData,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: forwardRef(function MockLink(
      { to, children, ...props }: { to: unknown; children?: ReactNode },
      ref: React.ForwardedRef<HTMLAnchorElement>,
    ) {
      return (
        <a ref={ref} href={typeof to === "string" ? to : "/"} {...props}>
          {children}
        </a>
      );
    }),
  };
});

describe("NavigationLink", () => {
  beforeEach(() => {
    mocks.prefetchChunk.mockClear();
    mocks.prefetchData.mockClear();
    mocks.saveData = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warms the chunk and the route data after a short hover intent", () => {
    render(<NavigationLink to="/thread/7">open</NavigationLink>);

    fireEvent.mouseEnter(screen.getByText("open"));
    expect(mocks.prefetchChunk).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(50));

    expect(mocks.prefetchChunk).toHaveBeenCalledWith("/thread/7");
    expect(mocks.prefetchData).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/thread/7", search: "" }),
    );
  });

  it("does not warm when the pointer leaves before the intent delay", () => {
    render(<NavigationLink to="/thread/7">open</NavigationLink>);

    const link = screen.getByText("open");
    fireEvent.mouseEnter(link);
    fireEvent.mouseLeave(link);
    act(() => vi.advanceTimersByTime(100));

    expect(mocks.prefetchChunk).not.toHaveBeenCalled();
    expect(mocks.prefetchData).not.toHaveBeenCalled();
  });

  it("warms immediately on keyboard focus", () => {
    render(<NavigationLink to="/profile/5">open</NavigationLink>);

    fireEvent.focus(screen.getByText("open"));

    expect(mocks.prefetchChunk).toHaveBeenCalledWith("/profile/5");
  });

  it("splits the query string off the pathname", () => {
    render(<NavigationLink to="/profile/5?tab=wall">open</NavigationLink>);

    fireEvent.focus(screen.getByText("open"));

    expect(mocks.prefetchChunk).toHaveBeenCalledWith("/profile/5");
    expect(mocks.prefetchData).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/profile/5", search: "?tab=wall" }),
    );
  });

  it("does not warm on a Save-Data connection", () => {
    mocks.saveData = true;
    render(<NavigationLink to="/thread/7">open</NavigationLink>);

    fireEvent.focus(screen.getByText("open"));

    expect(mocks.prefetchChunk).not.toHaveBeenCalled();
    expect(mocks.prefetchData).not.toHaveBeenCalled();
  });

  it("honours prefetchData={false}", () => {
    render(
      <NavigationLink to="/thread/7" prefetchData={false}>
        open
      </NavigationLink>,
    );

    fireEvent.focus(screen.getByText("open"));

    expect(mocks.prefetchChunk).not.toHaveBeenCalled();
    expect(mocks.prefetchData).not.toHaveBeenCalled();
  });

  it("accepts the legacy prefetchRoute={false} alias", () => {
    render(
      <NavigationLink to="/thread/7" prefetchRoute={false}>
        open
      </NavigationLink>,
    );

    fireEvent.focus(screen.getByText("open"));

    expect(mocks.prefetchChunk).not.toHaveBeenCalled();
  });

  it("warms only once across repeated intent", () => {
    render(<NavigationLink to="/thread/7">open</NavigationLink>);

    const link = screen.getByText("open");
    fireEvent.focus(link);
    fireEvent.focus(link);
    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(100));

    expect(mocks.prefetchChunk).toHaveBeenCalledTimes(1);
    expect(mocks.prefetchData).toHaveBeenCalledTimes(1);
  });

  it("warms when the link scrolls into view", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const instances: Array<{ trigger: () => void }> = [];
    class MockObserver {
      root = null;
      rootMargin = "";
      thresholds = [];
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {
        instances.push(this);
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
      takeRecords = () => [];
      trigger() {
        this.cb([{ isIntersecting: true }]);
      }
    }
    const original = window.IntersectionObserver;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      MockObserver as unknown as typeof IntersectionObserver;

    render(
      <NavigationLink to="/thread/7" prefetchOnViewport>
        open
      </NavigationLink>,
    );

    expect(observe).toHaveBeenCalled();
    act(() => instances[0].trigger());

    expect(mocks.prefetchChunk).toHaveBeenCalledWith("/thread/7");
    expect(mocks.prefetchData).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();

    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = original;
  });
});
