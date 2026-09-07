import { useSyncExternalStore } from "react";

/**
 * Session-scoped record of wall posts the current user has already reported.
 * Lives in a module-level Set so every menu/dialog instance shares the same
 * view of "reported by me" — after the first report (or a 409 from the
 * server) the menu item turns into a disabled "Вы уже пожаловались" state
 * instead of letting the user file a second report.
 *
 * It is a per-browser-session hint only: the server UNIQUE(post_id,
 * reporter_id) constraint is the real dedupe, and a 409 re-marks the post in
 * case the set was reset (e.g. reload) while a report already exists.
 */
const reportedPosts = new Set<string>();
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

export const markReported = (postId: string) => {
  if (reportedPosts.has(postId)) return;
  reportedPosts.add(postId);
  notify();
};

export const hasReported = (postId: string): boolean => reportedPosts.has(postId);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** React hook — re-renders the caller when the reported-post set changes. */
export const useReportedPosts = (): ReadonlySet<string> =>
  useSyncExternalStore(
    subscribe,
    () => reportedPosts,
    () => reportedPosts,
  );

/** Test-only helper — clears the reported-post set (fresh module state per test). */
export const resetReportedPosts = (): void => {
  reportedPosts.clear();
  notify();
};