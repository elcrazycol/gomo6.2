import { useCallback, useEffect, useState } from "react";

import { prefersReducedMotion, type TransitionStyle } from "@/lib/viewTransitions";

/**
 * A tiny looping mock of the content swap, shown in Settings → «Анимация
 * переходов».
 *
 * The two layers reuse the real keyframes (see index.css `.vt-preview-*`), so
 * what the user sees here is what the app does — and it works even in browsers
 * without the View Transitions API, since the mock is plain CSS.
 *
 * The rail under the mock reads as a timeline:
 *
 *     ●──────────────◆──────────────●
 *   page 1      animation        page 2
 *
 * The dot at each end is a page; the marker in the CENTRE is the moment the
 * animation plays. A glowing head travels page 1 ↔ page 2, and each time it
 * crosses the centre the scene swaps and the centre pulses — both driven by the
 * same `LOOP_MS` as the JS timer, so they stay in lockstep.
 */

/** Time for the head to travel from one page to the other. */
const LOOP_MS = 2200;

/** Mock «Лента»: a couple of card rows. */
const ScreenFeed = () => (
  <div className="flex h-full flex-col justify-center gap-1.5">
    {[0, 1, 2].map((i) => (
      <div key={i} className="rounded-lg border border-border/60 bg-surface p-2">
        <div className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full bg-muted" />
          <span className="h-2 w-16 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-muted-foreground/25" style={{ width: `${72 - i * 12}%` }} />
      </div>
    ))}
  </div>
);

/** Mock «Раздел»: a title row and a dense list. */
const ScreenSection = () => (
  <div className="flex h-full flex-col justify-center gap-1.5">
    <div className="flex items-center justify-between">
      <span className="h-3 w-24 rounded-full bg-primary/60" />
      <span className="h-3 w-10 rounded-full bg-muted" />
    </div>
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex items-center gap-2 border-b border-border/40 py-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
        <span
          className="h-2 rounded-full bg-muted-foreground/25"
          style={{ width: `${68 - i * 11}%` }}
        />
      </div>
    ))}
  </div>
);

interface TransitionPreviewProps {
  style: TransitionStyle;
}

export const TransitionPreview = ({ style }: TransitionPreviewProps) => {
  const reducedMotion = prefersReducedMotion();
  // `run` keys the scene so every swap replays the CSS animation from zero.
  const [run, setRun] = useState(0);
  // false → page 1 is on screen, true → page 2 (the scene swap point).
  const [atSecond, setAtSecond] = useState(false);

  // The head travels to the centre in half a loop, so the swap must fire there
  // and then once per full loop, staying in sync with the CSS head/pulse.
  const advance = useCallback(() => {
    setAtSecond((prev) => !prev);
    setRun((r) => r + 1);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    let timer: number;
    const tick = () => {
      advance();
      timer = window.setTimeout(tick, LOOP_MS);
    };
    timer = window.setTimeout(tick, LOOP_MS / 2);
    return () => window.clearTimeout(timer);
  }, [advance, reducedMotion]);

  // The swap we just performed: page 1 → page 2 is "forward", the way back is
  // "back". Only the slide style reads it, to pick the direction of the push.
  const direction = atSecond ? "forward" : "back";

  return (
    <div className="space-y-3">
      <div className="vt-preview">
        <div key={run} className="vt-preview-scene" data-style={style} data-direction={direction}>
          <div className="vt-preview-layer vt-preview-layer--old">
            {atSecond ? <ScreenFeed /> : <ScreenSection />}
          </div>
          <div className="vt-preview-layer vt-preview-layer--new">
            {atSecond ? <ScreenSection /> : <ScreenFeed />}
          </div>
        </div>
      </div>

      {!reducedMotion && (
        <div className="vt-preview-track" aria-hidden="true">
          <span className="vt-preview-track-dot" />
          <span className="vt-preview-track-center" style={{ animationDuration: `${LOOP_MS}ms` }} />
          <span className="vt-preview-track-dot vt-preview-track-dot--end" />
          <span className="vt-preview-track-head" style={{ animationDuration: `${LOOP_MS}ms` }} />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {style === "slide"
          ? direction === "forward"
            ? "Вперёд — слайд влево"
            : "Назад — слайд вправо"
          : style === "none"
            ? "Экран меняется мгновенно"
            : "Так выглядит смена экрана"}
      </p>

      {reducedMotion && (
        <p className="text-[11px] text-muted-foreground">
          Система просит уменьшить движение — анимации отключены.
        </p>
      )}
    </div>
  );
};
