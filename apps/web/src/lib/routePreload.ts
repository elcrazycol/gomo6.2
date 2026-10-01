import type { Location } from "react-router-dom";

/**
 * Route data preloaders — the "stale-view retention" half of page transitions.
 *
 * When the URL changes, the router keeps the PREVIOUS page on screen and runs
 * the matching preloader for the target route. Only once its data is ready does
 * it swap (with the chosen transition). A route with no preloader swaps
 * immediately, so pages opt in one at a time and nothing is blocked by default.
 *
 * A preloader must warm whatever cache the page reads on mount, so the page
 * paints instantly after the swap (e.g. Profile reads its row through getCached,
 * so the preloader fills that same cache entry). It never renders anything.
 */
type RoutePreloader = (location: Location) => Promise<void> | void;

const entries: { match: RegExp; load: RoutePreloader }[] = [];

export function registerRoutePreloader(match: RegExp, load: RoutePreloader): void {
  entries.push({ match, load });
}

/** Run the preloader for `location`, if any. Failures are swallowed — the page
 *  retries on mount and the swap must not hang. */
export async function preloadRoute(location: Location): Promise<void> {
  const entry = entries.find((candidate) => candidate.match.test(location.pathname));
  if (!entry) return;
  try {
    await entry.load(location);
  } catch {
    /* the page refetches on mount */
  }
}
