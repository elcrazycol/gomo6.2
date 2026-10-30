import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { springFor } from "@/lib/motion";

interface UnreadBadgeProps {
  count: number;
  /** Counts above this render as "N+". */
  max?: number;
}

/**
 * The unread counter that hangs off the header icons (bell, messenger).
 *
 * Deliberately quiet: it wears the theme accent instead of alarm red and stays
 * a step smaller than the icon it sits on, so it reads as a hint rather than
 * something shouting for attention. Shared so the bell and the messenger can
 * never drift apart.
 *
 * The number bumps (scale 1.35 → 1) only when the value actually changes — the
 * same rule as the like counter: data arrives in its final form, motion marks
 * the event. First paint is instant, never a pop.
 */
export const UnreadBadge = ({ count, max = 99 }: UnreadBadgeProps) => {
  const reduce = useReducedMotion();
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
  }, []);

  if (count <= 0) return null;

  return (
    <motion.span
      key={count}
      initial={mountedRef.current && !reduce ? { scale: 1.35, opacity: 0.4 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={springFor("pop", reduce)}
      className="absolute -top-1 -right-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none tabular-nums text-primary-foreground"
    >
      {count > max ? `${max}+` : count}
    </motion.span>
  );
};
