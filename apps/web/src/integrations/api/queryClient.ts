import { QueryClient } from "@tanstack/react-query";

/**
 * The app-wide TanStack Query client.
 *
 * It lives in its own module (not inline in `App.tsx`) so route data
 * preloaders can warm the exact cache entries the pages read on mount through
 * `queryClient.ensureQueryData(...)` — the route-data registry is the only
 * other consumer. Tests keep creating their own throwaway clients, so this
 * singleton never leaks into a test.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh
      gcTime: 10 * 60 * 1000, // 10 minutes - cache retention
      refetchOnWindowFocus: false, // Don't refetch on window focus
      // Stale-while-revalidate: a mount renders cached data instantly and, if
      // it is older than the query's staleTime, revalidates in the background.
      // Fresh data (e.g. just warmed by a route preloader) is not refetched.
      refetchOnMount: true,
      retry: 1, // Only retry once on failure
    },
  },
});
