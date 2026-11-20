import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { EASE_OUT_EXPO } from "@/lib/motion";
import { useTransitionStyle } from "@/hooks/useTransitionStyle";

/** The shared entrance both components below play. No scale: these wrappers
 *  hold whole screens/lists, and scaling them re-rasters every card and photo
 *  inside for the duration of the enter. */
const ENTER_FROM = { opacity: 0, y: 10 } as const;
const ENTER_TO = { opacity: 1, y: 0 } as const;

const enterTransition = {
  opacity: { duration: 0.16, ease: EASE_OUT_EXPO },
  y: { duration: 0.2, ease: EASE_OUT_EXPO },
};

interface EnterProps {
  className?: string;
  style?: CSSProperties;
  /** Testing hook (the only extra DOM prop these wrappers take). */
  "data-testid"?: string;
  children: ReactNode;
}

/**
 * Mount entrance for content containers (section lists, tab bodies, page
 * blocks, skeletons): a dimensional morph, not a bare fade (MOTION_DESIGN
 * pattern 2 — голый opacity-fade это «веб-страница с CSS-переходами»).
 * Opacity rides the expo light-twin; geometry settles on the shared standard
 * spring. Plays once per mount — a `key` change remounts and replays it.
 * Renders a plain div when motion is off (Settings «Без анимации» or OS
 * reduced motion): same end state, zero animation.
 */
export const ContentEnter = ({ className, style, "data-testid": testId, children }: EnterProps) => {
  const transitionStyle = useTransitionStyle();
  const reduceMotion = useReducedMotion();
  if (transitionStyle === "none" || reduceMotion) {
    return <div className={className} style={style} data-testid={testId}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      style={style}
      data-testid={testId}
      initial={ENTER_FROM}
      animate={ENTER_TO}
      transition={enterTransition}
    >
      {children}
    </motion.div>
  );
};

interface ShowEnterProps extends EnterProps {
  /** Whether the view is the one on screen. */
  shown: boolean;
}

/**
 * Entrance for retained views (mounted while hidden, e.g. feed/section
 * views in Index): same morph, but replayed every time the view returns to
 * the screen — without remounting (which would drop the view's state).
 * The first show belongs to the page-level enter and stays instant.
 */
export const PendingViewEnter = ({ shown, className, style, "data-testid": testId, children }: ShowEnterProps) => {
  const transitionStyle = useTransitionStyle();
  const reduceMotion = useReducedMotion();
  const controls = useAnimationControls();
  const prevShownRef = useRef<boolean | null>(null);

  useEffect(() => {
    const was = prevShownRef.current;
    prevShownRef.current = shown;
    // Animate only a return to the screen (hidden → shown), never the first
    // paint and never the hide.
    if (!shown || was !== false) return;
    if (transitionStyle === "none" || reduceMotion) return;
    controls.set(ENTER_FROM);
    void controls.start({ ...ENTER_TO, transition: enterTransition });
  }, [shown, transitionStyle, reduceMotion, controls]);

  return (
    <motion.div className={shown ? className : "hidden"} style={style} data-testid={testId} initial={false} animate={controls}>
      {children}
    </motion.div>
  );
};
