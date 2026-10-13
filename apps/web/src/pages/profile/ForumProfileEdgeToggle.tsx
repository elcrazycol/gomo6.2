import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ForumSide = "left" | "right";

export interface ForumProfileEdgeToggleProps {
  side: ForumSide;
  /** This side currently hosts the forum panel. */
  active: boolean;
  onToggle: (side: ForumSide) => void;
  /**
   * Width of the gutter, measured from the matching viewport edge to the content
   * column (e.g. `clamp(0px, calc(50vw - 336px), 40rem)`). The gutter is only
   * the *positioning context* for the control, and the hover target that reveals
   * it — the click target is the small button inside it.
   */
  gutterWidth?: string;
  /** Distance from the content column to the button. */
  gap?: string;
}

/**
 * Small, barely-there control that unfolds the profile into the forum layout.
 *
 * Desktop only (there is no hover on touch, and the two-column layout needs the
 * width). It is deliberately tiny: the button sits a fixed gap from the content
 * column, stays fully transparent until the gutter beside the column is hovered,
 * and is always visible (dimmed) while its side hosts the forum panel, so the
 * active side is obvious without hovering. The active side closes the layout.
 */
export function ForumProfileEdgeToggle({
  side,
  active,
  onToggle,
  gutterWidth = "40px",
  gap = "48px",
}: ForumProfileEdgeToggleProps) {
  const { t } = useTranslation();
  const isLeft = side === "left";
  const Icon = isLeft ? ChevronLeft : ChevronRight;
  const label = active ? t("profile.collapseForum") : t("profile.expandForum");

  return (
    <div
      // Hover surface only — the whole strip reveals the chevron as the cursor
      // approaches, but it carries no click handler, so a stray click beside the
      // content does nothing. Only the small button toggles the layout.
      className="group/edge fixed inset-y-0 z-30 hidden lg:block"
      style={isLeft ? { left: 0, width: gutterWidth } : { right: 0, width: gutterWidth }}
    >
      <button
        type="button"
        data-testid="forum-edge-button"
        data-forum-edge={side}
        onClick={() => onToggle(side)}
        aria-label={label}
        aria-pressed={active}
        title={label}
        style={isLeft ? { right: gap } : { left: gap }}
        className="absolute top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-primary outline-none transition-opacity duration-200 group-hover/edge:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon
          data-testid="forum-edge-chevron"
          className={`h-4 w-4 transition-all duration-200 group-hover/edge:drop-shadow-[0_0_8px_oklch(var(--primary)/0.55)] ${
            active ? "opacity-70" : "opacity-0"
          }`}
          strokeWidth={2}
        />
      </button>
    </div>
  );
}
