import { useId } from "react";
import { cn } from "@/lib/utils";
import { MAX_RING_SEGMENTS } from "./StoryRing";

export type StorySquareRingProps = {
  /** Total live slides — one arc each. */
  total: number;
  /** How many of them this viewer has already opened. */
  read?: number;
  /** Draw the close-friends (green) gradient. */
  closeFriends?: boolean;
  /** Anything inside the ring (the avatar itself). */
  children: React.ReactNode;
  className?: string;
};

/**
 * Segmented story ring drawn as a rounded rectangle — the square-avatar twin
 * of StoryRing (circles). Unread slides use the brand gradient, read ones a
 * thin muted stroke, gaps are the theme background so divisions stay readable.
 *
 * Segment geometry uses `pathLength={100}` so arcs are plain percentages of
 * the perimeter; the first segment starts near the top edge (`START_AT`).
 */
const START_AT = 18;

export function StorySquareRing({
  total,
  read = 0,
  closeFriends = false,
  children,
  className,
}: StorySquareRingProps) {
  const rawId = useId();
  const gradientId = `story-square-ring-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const segments = Math.max(0, Math.min(total, MAX_RING_SEGMENTS));
  const readSegments =
    total === 0 ? 0 : Math.round(Math.min(Math.max(read, 0), total) * (segments / total));
  const gap = segments <= 3 ? 7 : 5;
  const step = segments > 0 ? 100 / segments : 0;
  const segLen = Math.max(step - gap, 1);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {segments > 0 && (
        <svg
          aria-hidden="true"
          data-testid="story-square-ring-svg"
          viewBox="0 0 100 100"
          className="pointer-events-none absolute -inset-[5px] h-[calc(100%+10px)] w-[calc(100%+10px)]"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop
                offset="0%"
                stopColor={closeFriends ? "var(--story-ring-close-from)" : "var(--story-ring-from)"}
              />
              <stop
                offset="100%"
                stopColor={closeFriends ? "var(--story-ring-close-to)" : "var(--story-ring-to)"}
              />
            </linearGradient>
          </defs>
          {segments === 1 ? (
            <rect
              x="8"
              y="8"
              width="84"
              height="84"
              rx="26"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={4}
              strokeLinejoin="round"
            />
          ) : (
            Array.from({ length: segments }, (_, index) => (
              <rect
                key={index}
                data-segment={index}
                data-read={index < readSegments ? "true" : "false"}
                x="8"
                y="8"
                width="84"
                height="84"
                rx="26"
                fill="none"
                pathLength={100}
                stroke={index < readSegments ? "oklch(var(--muted-foreground) / 0.55)" : `url(#${gradientId})`}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={`${segLen} ${100 - segLen}`}
                strokeDashoffset={START_AT - index * step}
              />
            ))
          )}
        </svg>
      )}
      {children}
    </span>
  );
}
