import { useEffect, useState } from "react";

/** Keep slightly above the CSS transition duration (300ms) so the collapse
 *  animation always completes before the box is unmounted. */
const COLLAPSE_TIMEOUT_MS = 320;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface UseComposerExpandOptions {
  /** Start collapsed as a quiet one-line prompt and reveal the editor on tap. */
  focusToExpand?: boolean;
  /** Live plain-text draft — a non-empty draft keeps the box open forever. */
  text: string;
  /** Non-null reply target wakes the box open in reply mode. */
  replyTo?: { id: string } | null;
  /** Bumped by the parent after a successful submit (draft cleared). */
  resetKey?: string | number;
}

/**
 * Shared pill ↔ expanded state machine for focus-to-expand composers (wall
 * comments, thread comments, …). Owns:
 *
 *  • expand on tap / reply-target, collapse on blur-while-empty / after a
 *    successful submit (resetKey), animated via grid-rows + opacity;
 *  • the "keep open with typed text" rule — a non-empty draft or an active
 *    reply target never collapses;
 *  • the collapse-finish timer (waits for the CSS transition, honors reduced
 *    motion).
 *
 * Surfaces layer their own chrome (banners, send buttons, toolbars) on top.
 */
export function useComposerExpand({ focusToExpand = false, text, replyTo, resetKey }: UseComposerExpandOptions) {
  const [expanded, setExpanded] = useState(!focusToExpand);
  const [closing, setClosing] = useState(false);

  // A non-empty draft or an active reply target forces the box open (and
  // keeps it open) regardless of the collapse animation.
  const isExpanded = !focusToExpand || expanded || Boolean(text.trim()) || Boolean(replyTo);
  // showBox additionally stays true while the collapse animation runs (closing),
  // so the box is not unmounted until the grid-rows transition completes.
  const showBox = !focusToExpand || expanded || closing || Boolean(text.trim()) || Boolean(replyTo);

  const finishCollapse = () => {
    setExpanded(false);
    setClosing(false);
  };

  const expand = () => {
    setExpanded(true);
    setClosing(false);
  };

  const requestCollapse = () => {
    if (!focusToExpand || !expanded || closing) return;
    setClosing(true);
  };

  // Choosing a reply target wakes the composer up in reply mode — and cancels
  // an in-flight collapse so the freshly chosen target isn't swallowed.
  useEffect(() => {
    if (replyTo) {
      setExpanded(true);
      setClosing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyTo?.id]);

  // After a successful submit the parent clears the draft and bumps resetKey —
  // fold the composer back into its quiet one-line prompt (animated).
  useEffect(() => {
    if (focusToExpand && !text.trim()) {
      requestCollapse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Finish the collapse once the grid-rows transition has had time to run;
  // under reduced motion it snaps instantly.
  useEffect(() => {
    if (!closing) return;
    if (prefersReducedMotion()) {
      finishCollapse();
      return;
    }
    const timer = window.setTimeout(finishCollapse, COLLAPSE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  return { expanded, closing, isExpanded, showBox, expand, requestCollapse, finishCollapse };
}
