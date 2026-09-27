import { useLoadingBarStore } from "@/stores/loadingBarStore";

/**
 * Thin indeterminate progress line pinned to the header's bottom edge.
 *
 * It fades in whenever any view is loading, so switching between the feed and
 * a section never flashes a skeleton over the content you were already
 * reading — the current view stays put and this line says "something's coming".
 */
export const TopLoadingBar = () => {
  const active = useLoadingBarStore((state) => state.count > 0);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden transition-opacity duration-200 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-primary/15" />
      {active && (
        <span className="loading-bar-segment absolute inset-y-0 w-1/3 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
      )}
    </div>
  );
};
