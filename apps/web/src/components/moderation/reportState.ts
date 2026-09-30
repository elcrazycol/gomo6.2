import { useSyncExternalStore } from "react";

/**
 * Session-scoped record of targets the current user has already reported, keyed
 * by "<target_type>:<target_id>" so a wall-post id and a thread id can never
 * collide. Lives in a module-level Set so every menu/dialog instance shares the
 * same view of "reported by me" — after the first report (or a 409 from the
 * server) the menu item turns into a disabled "Вы уже пожаловались" state
 * instead of letting the user file a second report.
 *
 * It is a per-browser-session hint only: the server UNIQUE(target_type,
 * target_id, reporter_id) constraint is the real dedupe, and a 409 re-marks the
 * target in case the set was reset (e.g. reload) while a report already exists.
 */
const reportedTargets = new Set<string>();
const listeners = new Set<() => void>();

const targetKey = (targetType: string, targetId: string): string => `${targetType}:${targetId}`;

const notify = () => {
  listeners.forEach((listener) => listener());
};

export const markReported = (targetType: string, targetId: string) => {
  const key = targetKey(targetType, targetId);
  if (reportedTargets.has(key)) return;
  reportedTargets.add(key);
  notify();
};

export const hasReported = (targetType: string, targetId: string): boolean =>
  reportedTargets.has(targetKey(targetType, targetId));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** React hook — re-renders the caller when the reported-target set changes. */
export const useReportedTargets = (): ReadonlySet<string> =>
  useSyncExternalStore(
    subscribe,
    () => reportedTargets,
    () => reportedTargets,
  );

/** Convenience for a single target. */
export const useIsReported = (targetType: string, targetId: string): boolean => {
  const reported = useReportedTargets();
  return reported.has(targetKey(targetType, targetId));
};

/** Test-only helper — clears the reported set (fresh module state per test). */
export const resetReportedTargets = (): void => {
  reportedTargets.clear();
  notify();
};
