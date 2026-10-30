// One physical language for every header icon button.
//
// The row shares a single ink blob (see ui/ink-bar) that glides between the
// hovered buttons on SPRING.snappy instead of each button flashing its own
// flat hover tint. On top of the blob the icon itself breathes (hover 1.08)
// and presses (tap 0.94) — same preset, no CSS duration curves. Route buttons
// additionally park a 4px active dot with a shared layoutId, so navigating
// settings <-> quests slides one dot instead of blinking two underlines.
//
// data-ink marks the element InkBar measures: it must be the element whose
// offsetParent is the InkBar container. Buttons nested inside a positioned
// wrapper (the bell's hover-panel root) set ink={false} and mark the wrapper
// instead — measuring the inner button would glide the blob to the wrapper's
// origin.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT_EXPO, pressFeedback, springFor } from "@/lib/motion";
import { INK_ATTR } from "@/components/ui/ink-bar";
import { NavigationLink } from "@/components/NavigationLink";
import { cn } from "@/lib/utils";

const visualClass = (active: boolean, className = "") =>
  cn(
    "relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
    "text-muted-foreground transition-colors hover:text-foreground",
    active && "text-primary",
    className,
  );

export function HeaderIconVisual({
  label,
  active = false,
  badge,
  ink = true,
  className = "",
  children,
}: {
  /** Accessible name lives on the interactive parent; the visual is silent. */
  label?: string;
  /** Parks the sliding route dot. */
  active?: boolean;
  /** Overlay badge (unread count). Rendered above the icon, never scaled. */
  badge?: ReactNode;
  /** Disable when nested in a positioned wrapper — mark the wrapper instead. */
  ink?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden={label ? true : undefined}
      {...(ink ? { [INK_ATTR]: true } : {})}
      className={visualClass(active, className)}
      {...pressFeedback(reduce)}
      whileHover={reduce ? undefined : { scale: 1.08 }}
      transition={springFor("snappy", reduce)}
    >
      {children}
      {badge}
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="header-active-dot"
          className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary"
          initial={reduce ? false : { opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            ...springFor("snappy", reduce),
            opacity: { duration: 0.16, ease: EASE_OUT_EXPO },
          }}
        />
      )}
    </motion.span>
  );
}

/** Action button (search toggle, burger trigger, lens). */
export function HeaderIconButton({
  label,
  active = false,
  badge,
  ink = true,
  className = "",
  testId,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: ReactNode;
  ink?: boolean;
  className?: string;
  testId?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <HeaderIconVisual label={label} active={active} badge={badge} ink={ink} className={className}>
        {children}
      </HeaderIconVisual>
    </button>
  );
}

/** Route button (settings, quests): keeps NavigationLink prefetch + semantics. */
export function HeaderIconLink({
  to,
  label,
  title,
  active = false,
  badge,
  ink = true,
  className = "",
  children,
}: {
  to: string;
  label: string;
  title?: string;
  active?: boolean;
  badge?: ReactNode;
  ink?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <NavigationLink
      to={to}
      aria-label={label}
      title={title}
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <HeaderIconVisual label={label} active={active} badge={badge} ink={ink} className={className}>
        {children}
      </HeaderIconVisual>
    </NavigationLink>
  );
}
