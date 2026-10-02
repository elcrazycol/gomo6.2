import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ForumSide = "left" | "right";

export interface ForumProfileEdgeToggleProps {
  side: ForumSide;
  /** This side currently hosts the forum panel. */
  active: boolean;
  onToggle: (side: ForumSide) => void;
  /**
   * Width of the hover gutter, measured from the matching viewport edge to the
   * content column (e.g. `clamp(0px, calc(50vw - 336px), 40rem)`). The control
   * reveals anywhere in this gutter, so a wide value makes it easy to hit.
   */
  gutterWidth?: string;
  /** Distance from the content column to the button. */
  gap?: string;
}

/**
 * Barely-there gutter control that unfolds the profile into the forum layout.
 *
 * Desktop only (there is no hover on touch, and the two-column layout needs the
 * width). It lives in the gutter beside the content column — the whole gutter is
 * a hover target, while the chevron itself sits a fixed gap away from the
 * content — and fades in with a soft, static glow in the theme's primary
 * colour. The same control closes the layout when its side is active; the
 * opposite one moves the panel across.
 */
export function ForumProfileEdgeToggle({
  side,
  active,
  onToggle,
  gutterWidth = "40px",
  gap = "64px",
}: ForumProfileEdgeToggleProps) {
  const { t } = useTranslation();
  const isLeft = side === "left";
  const Icon = isLeft ? ChevronLeft : ChevronRight;
  const label = active ? t("profile.collapseForum") : t("profile.expandForum");

  return (
    <div
      className="group/edge fixed inset-y-0 z-30 hidden lg:block"
      style={isLeft ? { left: 0, width: gutterWidth } : { right: 0, width: gutterWidth }}
    >
      <button
        type="button"
        onClick={() => onToggle(side)}
        aria-label={label}
        aria-pressed={active}
        title={label}
        style={isLeft ? { right: gap } : { left: gap }}
        className={`absolute top-1/2 flex h-11 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground/70 outline-none transition-all duration-200 hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring ${
          active ? "opacity-100" : "opacity-0"
        } group-hover/edge:opacity-100`}
      >
        {/* Static glow — the brightest spot sits centred behind the glyph. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-2 rounded-full opacity-0 transition-opacity duration-200 group-hover/edge:opacity-100"
          style={{ background: "radial-gradient(circle, oklch(var(--primary) / 0.35) 0%, transparent 70%)" }}
        />
        <Icon className="relative h-6 w-6" strokeWidth={1.75} />
      </button>
    </div>
  );
}
