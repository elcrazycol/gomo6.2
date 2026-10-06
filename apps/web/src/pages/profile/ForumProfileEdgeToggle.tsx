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
   * column (e.g. `clamp(0px, calc(50vw - 336px), 40rem)`). This whole strip is
   * both the hover target and the click target.
   */
  gutterWidth?: string;
  /** Distance from the content column to the arrow. */
  gap?: string;
}

/**
 * Barely-there gutter control that unfolds the profile into the forum layout.
 *
 * Desktop only (there is no hover on touch, and the two-column layout needs the
 * width). The entire gutter beside the content column is a single transparent
 * button — hovering anywhere in it reveals a lone chevron and clicking anywhere
 * in it toggles the layout, so the arrow is pure affordance and the hit area is
 * as large as the strip. The same side closes the layout when it is active; the
 * opposite side moves the panel across.
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
    <button
      type="button"
      onClick={() => onToggle(side)}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={isLeft ? { left: 0, width: gutterWidth } : { right: 0, width: gutterWidth }}
      className="group/edge fixed inset-y-0 z-30 hidden cursor-pointer outline-none lg:block"
    >
      <Icon
        style={isLeft ? { right: gap } : { left: gap }}
        className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 text-primary transition-all duration-200 group-hover/edge:opacity-100 group-hover/edge:drop-shadow-[0_0_8px_oklch(var(--primary)/0.55)] ${
          active ? "opacity-70" : "opacity-0"
        }`}
        strokeWidth={2}
      />
    </button>
  );
}
