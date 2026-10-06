import { useEffect, useRef, useState } from "react";

import { getCached, peekCached, subscribe, type GetOptions } from "@/integrations/api/queryCache";

export interface UseCachedQueryOptions<T> extends GetOptions<T> {
  /** Skip the read entirely (e.g. a dialog that has not been opened). */
  enabled?: boolean;
}

export interface UseCachedQueryResult<T> {
  data: T | undefined;
  /** Set when a cold fetch fails; a failed background revalidation is ignored. */
  error: unknown;
}

/**
 * Stale-while-revalidate read for pages that fetch through `getCached` rather
 * than TanStack Query.
 *
 * Returns the warm value synchronously (route preloaders + previous visits fill
 * it), triggers a fetch when the entry is missing or stale, and re-renders with
 * the fresh value once a background revalidation lands. `data` is `undefined`
 * only on a cold start, which is the cue for a page to show its loader.
 *
 * The cache key must match whatever a route preloader warms — both come from
 * the same `routes/data/*` module.
 */
export function useCachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseCachedQueryOptions<T> = {},
): UseCachedQueryResult<T> {
  const { enabled = true } = options;
  const [state, setState] = useState<UseCachedQueryResult<T>>(() => ({
    data: enabled ? peekCached<T>(key) : undefined,
    error: undefined,
  }));

  // Keep the latest fetcher/options without making the effect re-run (a fresh
  // arrow function every render would otherwise loop forever).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    // The first render may have missed; the preloader/first fetch may now have
    // landed, so re-peek before subscribing.
    setState((prev) => ({ data: peekCached<T>(key), error: prev.error }));

    const load = () => {
      const { enabled: _enabled, ...getOptions } = optionsRef.current;
      getCached(key, () => fetcherRef.current(), getOptions)
        .then((value) => {
          if (active) setState({ data: value, error: undefined });
        })
        .catch((error) => {
          // Cold-start failure: keep any stale value, surface the error so the
          // page can stop its loader. A failed background revalidation never
          // rejects here (getCached keeps the stale entry).
          if (active) setState((prev) => ({ data: prev.data, error }));
        });
    };

    const unsubscribe = subscribe(key, () => {
      if (!active) return;
      const fresh = peekCached<T>(key);
      if (fresh !== undefined) {
        setState((prev) => ({ data: fresh, error: prev.error }));
      } else {
        // Invalidated or cleared — the SWR entry is gone, so refetch.
        load();
      }
    });

    load();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [key, enabled]);

  return state;
}
