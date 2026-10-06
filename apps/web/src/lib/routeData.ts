/**
 * Route-data registry — the "loaders" of this app's stale-while-revalidate
 * navigation. A route registers a `warm()` function that fills whatever cache
 * the page reads on mount (TanStack via `warmQuery`, the URL cache via
 * `getCached`), using the SAME key. Then:
 *
 *   • `preloadRoute(location)` — run before the router swaps views (retention):
 *     the previous page stays on screen until the target's data is ready.
 *   • `prefetchRouteData(location)` — fire-and-forget on link intent (hover):
 *     the data is already cached by the time the click lands.
 *
 * This replaces the single-purpose `lib/routePreload.ts`. It deliberately does
 * NOT use React Router's data router: the project already has a bespoke
 * transition engine (see `lib/viewTransitions.ts`) and four caches, and the
 * registry gives the same loader semantics without duplicating either.
 */
import { matchPath, type Location } from "react-router-dom";

import { queryClient } from "@/integrations/api/queryClient";
import { useLoadingBarStore } from "@/stores/loadingBarStore";

export interface RouteDataContext {
  location: Location;
  /** Path params captured by the entry's `match` pattern(s). */
  params: Record<string, string>;
}

export type RouteDataWarm = (ctx: RouteDataContext) => Promise<void> | void;

export interface RouteDataEntry {
  /** Stable id — re-registering the same id replaces it (HMR/dev). */
  id: string;
  /** One or more react-router path patterns this entry warms. */
  match: string | string[];
  /** Higher runs first; reserved for future scheduling. */
  priority?: number;
  warm: RouteDataWarm;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/** Warm the TanStack cache with the exact options a page's hook uses. */
export function warmQuery<T>(options: {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  staleTime?: number;
}): Promise<T> {
  return queryClient.ensureQueryData(options) as Promise<T>;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const entries = new Map<string, RouteDataEntry>();

export function registerRouteData(entry: RouteDataEntry): void {
  entries.set(entry.id, entry);
}

/** All entries matching `pathname`, most specific/last-registered last. */
export function matchedRouteData(pathname: string): RouteDataEntry[] {
  const matched: RouteDataEntry[] = [];
  for (const entry of entries.values()) {
    const patterns = Array.isArray(entry.match) ? entry.match : [entry.match];
    if (patterns.some((pattern) => matchPath({ path: pattern, end: true }, pathname))) {
      matched.push(entry);
    }
  }
  return matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** Test/HMR helper — clears the registry. */
export function __resetRouteData(): void {
  entries.clear();
}

const paramsFor = (entry: RouteDataEntry, pathname: string): Record<string, string> => {
  const patterns = Array.isArray(entry.match) ? entry.match : [entry.match];
  const params: Record<string, string> = {};
  for (const pattern of patterns) {
    const match = matchPath({ path: pattern, end: true }, pathname);
    if (!match) continue;
    for (const [key, value] of Object.entries(match.params)) {
      if (value != null) params[key] = value;
    }
  }
  return params;
};

const locationKey = (location: Location): string => `${location.pathname}${location.search}`;

// Concurrent warm-ups for the same location share one promise (an intent
// prefetch followed by the click must not double-fetch). Keys whose in-flight
// warm reports progress are tracked so a navigation joining a bar-less intent
// prefetch still shows the loading bar.
const inflight = new Map<string, Promise<void>>();
const inflightReportsProgress = new Set<string>();

// Only the newest navigation may keep warming; a superseded one stops between
// entries so a fast click-through never blocks on abandoned work.
let latestToken = 0;

/**
 * A hung preloader must not pin the previous view forever — the swap waits for
 * `preloadRoute`, so each loader is raced against this. A late resolution still
 * fills the cache; only the wait is bounded.
 */
export const LOADER_TIMEOUT_MS = 8000;

const withTimeout = (promise: Promise<unknown>, ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(settle, settle);
  });

// Dev-only coverage signal: a navigation to a route with no preloader is not
// necessarily wrong (auth/settings/legal legitimately have none), so this is a
// deduped console.debug rather than a warning.
const warnedPaths = new Set<string>();
function noteMissingPreloader(pathname: string): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test" || warnedPaths.has(pathname)) return;
  warnedPaths.add(pathname);
  console.debug(
    `[route-data] no preloader registered for ${pathname} — the swap will not wait for its data`,
  );
}

async function warmRoute(location: Location, reportProgress: boolean): Promise<void> {
  const key = locationKey(location);
  const pending = inflight.get(key);
  if (pending) return pending;

  const token = ++latestToken;
  const promise = (async () => {
    const { begin, end } = useLoadingBarStore.getState();
    if (reportProgress) begin();
    try {
      for (const entry of matchedRouteData(location.pathname)) {
        if (token !== latestToken) break;
        try {
          await withTimeout(
            Promise.resolve(
              entry.warm({
                location,
                params: paramsFor(entry, location.pathname),
              }),
            ),
            LOADER_TIMEOUT_MS,
          );
        } catch {
          // Best-effort: the page refetches on mount, the swap must not hang.
        }
      }
    } finally {
      if (reportProgress) {
        end();
        inflightReportsProgress.delete(key);
      }
      inflight.delete(key);
    }
  })();

  if (reportProgress) inflightReportsProgress.add(key);
  inflight.set(key, promise);
  return promise;
}

/** Whether any preloader is registered for `pathname`. */
export function hasRouteData(pathname: string): boolean {
  return matchedRouteData(pathname).length > 0;
}

/**
 * Run the target route's preloaders. The caller (App) keeps the previous view
 * on screen until this resolves, then animates the swap. Shows the header
 * loading bar while it runs.
 */
export function preloadRoute(location: Location): Promise<void> {
  if (!hasRouteData(location.pathname)) noteMissingPreloader(location.pathname);

  // A navigation may join an in-flight intent prefetch (whose promise is
  // already in `inflight`), which reports no progress. Wrap it so the header
  // loading bar still appears — otherwise a slow prefetch would leave the user
  // with no cue.
  const key = locationKey(location);
  const pending = inflight.get(key);
  if (pending && !inflightReportsProgress.has(key)) {
    const { begin, end } = useLoadingBarStore.getState();
    begin();
    return pending.finally(end);
  }

  return warmRoute(location, true);
}

/**
 * Fire-and-forget warm-up for link intent (hover/focus). Same cache fills as
 * `preloadRoute`, but never touches the loading bar and respects the user's
 * network preferences.
 */
export function prefetchRouteData(location: Location): void {
  if (!shouldPrefetch()) return;
  void warmRoute(location, false);
}

/**
 * Whether intent prefetching is welcome on this connection. Mirrors the
 * browser's Save-Data / slow-connection signals; explicit clicks still work.
 */
export function shouldPrefetch(): boolean {
  if (typeof navigator === "undefined") return true;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)2g$/.test(connection.effectiveType ?? "");
}
