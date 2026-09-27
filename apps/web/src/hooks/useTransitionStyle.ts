import { useEffect, useState } from "react";

import { getTransitionStyle, TRANSITION_STYLE_EVENT, type TransitionStyle } from "@/lib/viewTransitions";

/** The current transition style, live-updating when Settings changes it. */
export const useTransitionStyle = (): TransitionStyle => {
  const [style, setStyle] = useState<TransitionStyle>(getTransitionStyle);
  useEffect(() => {
    const sync = () => setStyle(getTransitionStyle());
    window.addEventListener(TRANSITION_STYLE_EVENT, sync);
    return () => window.removeEventListener(TRANSITION_STYLE_EVENT, sync);
  }, []);
  // The `.view-fade-in` CSS override keys off this flag, so the inner fade is
  // suppressed exactly when the browser animates the swap itself.
  useEffect(() => {
    document.documentElement.dataset.transitionStyle = style;
  }, [style]);
  return style;
};
