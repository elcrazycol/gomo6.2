import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Link, type LinkProps, type To } from "react-router-dom";

import { prefetchRouteChunk } from "@/lib/routeChunks";
import { prefetchRouteData, shouldPrefetch } from "@/lib/routeData";

/**
 * The one navigation link: `<Link>` + stale-while-revalidate prefetch.
 *
 * On intent (hover, keyboard focus, touch) it warms BOTH halves of a route —
 * the lazy chunk and the route's data (through the same registry the retention
 * swap uses). By the time the click lands, the target renders from cache.
 *
 * Hover is debounced so a quick mouse pass does not fetch; Save-Data / 2G
 * connections opt out entirely. `to` is used as-is (this app links with
 * absolute paths), which also keeps the component usable under the many test
 * mocks that provide only `Link` from react-router-dom.
 */
interface NavigationLinkProps extends LinkProps {
  /** Warm the route's data + chunk on intent. Default true. */
  prefetchData?: boolean;
  /** Also warm when the link scrolls into view. */
  prefetchOnViewport?: boolean;
  /** Legacy alias for `prefetchData` (the old PrefetchLink API). */
  prefetchRoute?: boolean;
  children?: ReactNode;
}

const INTENT_DELAY_MS = 50;

const toTarget = (to: To): { pathname: string; search: string } => {
  if (typeof to === "string") {
    const queryIndex = to.indexOf("?");
    return queryIndex === -1
      ? { pathname: to, search: "" }
      : { pathname: to.slice(0, queryIndex), search: to.slice(queryIndex) };
  }
  return { pathname: to.pathname ?? "", search: to.search ?? "" };
};

export const NavigationLink = ({
  to,
  prefetchData,
  prefetchOnViewport = false,
  prefetchRoute,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onTouchStart,
  children,
  ...props
}: NavigationLinkProps) => {
  const enabled = prefetchData ?? prefetchRoute ?? true;
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const warmRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const warm = useCallback(() => {
    if (warmRef.current || !enabled) return;
    warmRef.current = true;
    if (!shouldPrefetch()) return;
    const { pathname, search } = toTarget(to);
    prefetchRouteChunk(pathname);
    prefetchRouteData({
      pathname,
      search,
      hash: "",
      state: null,
      key: "prefetch",
    } as Parameters<typeof prefetchRouteData>[0]);
  }, [enabled, to]);

  const cancelScheduled = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => cancelScheduled, []);

  useEffect(() => {
    if (!prefetchOnViewport || !enabled) return;
    const node = anchorRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          warm();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [prefetchOnViewport, enabled, warm]);

  return (
    <Link
      {...props}
      ref={prefetchOnViewport ? anchorRef : undefined}
      to={to}
      onMouseEnter={(event) => {
        if (enabled && !warmRef.current) {
          cancelScheduled();
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            warm();
          }, INTENT_DELAY_MS);
        }
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        cancelScheduled();
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        // Keyboard navigation is explicit intent — no debounce.
        warm();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        // Touch has no hover; warming here beats waiting for the click.
        warm();
        onTouchStart?.(event);
      }}
    >
      {children}
    </Link>
  );
};
