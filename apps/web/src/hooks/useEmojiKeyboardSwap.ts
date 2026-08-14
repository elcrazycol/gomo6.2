import { useCallback, useEffect, useRef, useState } from "react";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { getMobileKeyboardState, isEditableElement } from "@/lib/mobileKeyboard";
import type { GomoRichEditorHandle } from "@/components/GomoRichEditor";

/**
 * Below this inset the keyboard is not up (or the platform reports the
 * keyboard via a layout resize instead of a visual-viewport delta) — fall
 * back to a provisional height and re-measure as the layout grows back.
 */
const MIN_KB_HEIGHT = 60;
/** Provisional panel height: typical soft keyboard ≈ 40% of the screen. */
const PROVISIONAL_RATIO = 0.4;
const PROVISIONAL_MAX = 420;
const PROVISIONAL_MIN = 280;

/**
 * Mobile emoji-panel ↔ soft-keyboard swap ("Telegram-style").
 *
 * On touch devices tapping the emoji trigger no longer opens a popover —
 * instead the soft keyboard slides away and an emoji panel slides up into
 * exactly the space the keyboard occupied:
 *
 *  • the panel height is the REAL keyboard height — on iOS read straight from
 *    the visual-viewport metrics (`--kb-inset`); on Android
 *    (`interactive-widget=resizes-content`) the layout viewport grows by the
 *    keyboard height once it hides, so we measure that growth and correct the
 *    panel;
 *  • the focused editor is blurred to dismiss the keyboard, but ProseMirror
 *    keeps the caret in its own state — nothing is lost;
 *  • tapping the trigger again closes the panel and refocuses the editor, so
 *    the keyboard returns with the caret where it was;
 *  • emoji insertions go through insertEmoji(data, { focus: false }) — no
 *    refocus, so the keyboard stays hidden and you can insert as many as you
 *    want;
 *  • the panel only closes on an explicit outside action: tapping the editor
 *    (focus lands on an editable), an outside click / Escape, or the trigger
 *    itself. Scrolling — inside the panel (the stacked pack list) or the page
 *    behind it — never dismisses it, so the picker is free to be a full
 *    scrollable surface.
 *
 * Desktop is untouched: the hook's state simply never activates (isTouch is
 * false there, and consumers gate the swap UI on it).
 */
export function useEmojiKeyboardSwap(
  editorRef: React.RefObject<GomoRichEditorHandle | null>
) {
  const { isTouch } = useMobileKeyboard();
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  // Tracks the Android height re-measure loop so it can be cancelled on
  // unmount / reopen instead of firing setHeight on a dead component.
  const measureTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (measureTimerRef.current !== null) {
        clearTimeout(measureTimerRef.current);
        measureTimerRef.current = null;
      }
    };
  }, []);

  const openPanel = useCallback(() => {
    // Snapshot the metrics BEFORE blurring: the blur starts the keyboard
    // dismissal, which collapses --kb-inset to 0 within a debounce window.
    const kb = getMobileKeyboardState();
    const beforeHeight = window.innerHeight;
    const inset = kb.keyboardInset;
    const provisional = Math.round(
      Math.max(PROVISIONAL_MIN, Math.min(PROVISIONAL_MAX, window.innerHeight * PROVISIONAL_RATIO))
    );
    setHeight(inset >= MIN_KB_HEIGHT ? inset : provisional);

    // Dismiss the keyboard: blur whatever editable is focused. ProseMirror
    // keeps the caret in its state, so the insertion point survives.
    const active = document.activeElement;
    if (active instanceof HTMLElement && isEditableElement(active)) {
      active.blur();
    }
    setOpen(true);

    if (inset < MIN_KB_HEIGHT) {
      // Android resizes-content: the layout viewport grows back by the exact
      // keyboard height once it hides — measure it and correct the panel so it
      // fills precisely the freed space. The growth can lag the keyboard
      // dismissal by half a second on slow devices; retry for a full second
      // instead of 300ms so the FIRST panel open is never smaller than the
      // keyboard it replaces (which made the composer redraw when the keyboard
      // came back).
      if (measureTimerRef.current !== null) {
        clearTimeout(measureTimerRef.current);
      }
      let attempts = 0;
      const measure = () => {
        const grown = window.innerHeight - beforeHeight;
        if (grown >= MIN_KB_HEIGHT) {
          measureTimerRef.current = null;
          setHeight(Math.round(grown));
          return;
        }
        if (++attempts < 20) {
          measureTimerRef.current = window.setTimeout(measure, 50);
        } else {
          measureTimerRef.current = null;
        }
      };
      measureTimerRef.current = window.setTimeout(measure, 50);
    }
  }, []);

  const closePanel = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      if (refocus) {
        // Bring the keyboard back with the caret intact.
        editorRef.current?.focus();
      }
    },
    [editorRef]
  );

  const toggle = useCallback(() => {
    if (openRef.current) closePanel(true);
    else openPanel();
  }, [closePanel, openPanel]);

  // If the user taps the editor (or any editable) while the panel is up, the
  // keyboard returns on its own — just dismiss the panel, don't fight it.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && isEditableElement(t)) setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // Deliberately NO page-scroll close: the panel is a scrollable surface
  // itself (stacked packs), and scrolling the page behind the bottom sheet
  // must not dismiss it — only an outside click / Escape / trigger / tapping
  // the editor does (all handled above and in EmojiPicker).

  return { isTouch, open, height, toggle, closePanel };
}
