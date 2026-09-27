import { useCallback, useEffect, useState } from "react";
import { PlayCircle, RotateCcw } from "lucide-react";

import { prefersReducedMotion, type TransitionDirection, type TransitionStyle } from "@/lib/viewTransitions";

/**
 * A tiny looping mock of the content swap, shown in Settings → «Анимация
 * переходов» when a style is expanded.
 *
 * The two layers reuse the real keyframes (see index.css `.vt-preview-*`), so
 * what the user sees here is what the app does — and it works even in browsers
 * without the View Transitions API, since the mock is plain CSS.
 */

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
  // `run` keys the scene so every play restarts the CSS animations from zero.
  const [run, setRun] = useState(0);
  const [atSection, setAtSection] = useState(false);
  const [direction, setDirection] = useState<TransitionDirection>("forward");

  const advance = useCallback(() => {
    setAtSection((v) => !v);
    setDirection((d) => (d === "forward" ? "back" : "forward"));
    setRun((r) => r + 1);
  }, []);

  // Auto-loop while the style is expanded, so nothing has to be pressed.
  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(advance, 2200);
    return () => window.clearInterval(id);
  }, [advance, reducedMotion]);

  return (
    <div className="space-y-2.5">
      <div className="vt-preview">
        <div key={run} className="vt-preview-scene" data-style={style} data-direction={direction}>
          <div className="vt-preview-layer vt-preview-layer--old">
            {atSection ? <ScreenFeed /> : <ScreenSection />}
          </div>
          <div className="vt-preview-layer vt-preview-layer--new">
            {atSection ? <ScreenSection /> : <ScreenFeed />}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {style === "slide"
            ? direction === "back"
              ? "Назад — слайд вправо"
              : "Вперёд — слайд влево"
            : style === "none"
              ? "Экран меняется мгновенно"
              : "Так выглядит смена экрана"}
        </p>
        <button
          type="button"
          onClick={advance}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {run === 0 ? <PlayCircle className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {run === 0 ? "Показать" : "Ещё раз"}
        </button>
      </div>

      {reducedMotion && (
        <p className="text-[11px] text-muted-foreground">
          Система просит уменьшить движение — анимации отключены.
        </p>
      )}
    </div>
  );
};
