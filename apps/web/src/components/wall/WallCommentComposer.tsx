import { useEffect, useState, type FocusEvent, type Ref } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";

interface WallCommentComposerProps {
  placeholder: string;
  onSubmit: () => void;
  onCancel?: () => void;
  isSubmitting: boolean;
  json: unknown;
  text: string;
  onChange: (v: { json: unknown; text: string }) => void;
  resetKey?: number;
  /** Maximum number of characters for a comment. Defaults to 4000. */
  maxLength?: number;
  compact?: boolean;
  /** Start as a calm one-line prompt and reveal the editor on focus. */
  focusToExpand?: boolean;
  /** Focus the editor as soon as it expands. */
  autoFocus?: boolean;
  /** When set, the composer answers this comment instead of posting top-level. */
  replyTo?: { id: string; name: string } | null;
  /** Imperative handle so the parent can focus the editor synchronously inside
      a tap (iOS only opens the keyboard for focus calls made within a user
      gesture, so the reply button must flush + focus, not wait for effects). */
  editorRef?: Ref<GomoRichEditorHandle>;
}

// Keep slightly above the CSS transition duration (300ms) so the collapse
// animation always completes before the box is unmounted.
const COLLAPSE_TIMEOUT_MS = 320;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const Pill = ({
  label,
  onClick,
  className = "",
  hidden = false,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  hidden?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    aria-hidden={hidden}
    tabIndex={hidden ? -1 : 0}
    className={`group flex min-h-11 w-full items-center gap-2 rounded-2xl border border-border/70 bg-background/85 px-3 text-left text-sm text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
  >
    <Sparkles className="h-4 w-4 text-primary/70 transition-transform group-hover:rotate-12" />
    <span>{label}</span>
  </button>
);

export const WallCommentComposer = ({
  placeholder,
  onSubmit,
  onCancel,
  isSubmitting,
  json,
  text,
  onChange,
  resetKey,
  maxLength = 4000,
  compact = false,
  focusToExpand = false,
  autoFocus = false,
  replyTo = null,
  editorRef,
}: WallCommentComposerProps) => {
  const [expanded, setExpanded] = useState(!focusToExpand);
  const [closing, setClosing] = useState(false);
  const isExpanded = !focusToExpand || expanded || Boolean(text.trim()) || Boolean(replyTo);

  const finishCollapse = () => {
    setExpanded(false);
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

  // Collapse on blur only while the draft is empty — never swallow typed text.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (focusToExpand && !text.trim() && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      requestCollapse();
    }
  };

  const editorPlaceholder = replyTo ? "Напишите ответ" : placeholder;
  const pillLabel = replyTo ? `Ответ для @${replyTo.name}…` : `${placeholder}…`;

  // replyTo forces the box open synchronously (before the setExpanded effect
  // above runs) so the editor is mounted the instant the reply target is set —
  // the parent flushes that state change and focuses in the same tap stack.
  const showBox = !focusToExpand || expanded || closing || Boolean(text.trim()) || Boolean(replyTo);

  // Collapsed: just the quiet one-line prompt.
  if (focusToExpand && !showBox) {
    return <Pill label={pillLabel} onClick={() => setExpanded(true)} />;
  }

  // The pill stays mounted UNDER the editor at all times — while expanded it is
  // hidden and covered by the opaque box, and during the collapse it is revealed
  // as the box fades away. Nothing ever gets "swapped in", so there is no flash.
  const underlayHidden = expanded && !closing;

  return (
    <div className={`relative ${focusToExpand ? "min-h-11" : ""}`}>
      {focusToExpand && (
        <Pill
          label={pillLabel}
          onClick={() => setExpanded(true)}
          hidden={underlayHidden}
          className={`absolute inset-x-0 bottom-0 transition-opacity ${underlayHidden ? "pointer-events-none opacity-0" : "opacity-100"}`}
        />
      )}
      <div
        onBlur={handleBlur}
        className={`relative z-10 grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${closing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`space-y-2 rounded-2xl border border-border/70 bg-background p-2 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none ${compact ? "" : "p-3"}`}>
            {replyTo && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-2.5 py-1.5">
                <span className="min-w-0 truncate text-xs text-foreground/80">
                  Ответ <span className="font-semibold text-primary">@{replyTo.name}</span>
                </span>
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    aria-label="Отменить ответ"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <GomoRichEditor
              ref={editorRef}
              autoFocus={autoFocus}
              resetKey={resetKey}
              maxLength={maxLength}
              contentJson={json}
              legacyContent={text}
              onChange={onChange}
              onSubmit={onSubmit}
              placeholder={editorPlaceholder}
              minHeightClassName={compact ? "min-h-[60px]" : "min-h-[84px]"}
              maxHeightClassName={compact ? "max-h-[30vh] overflow-y-auto overscroll-contain" : "max-h-[40vh] overflow-y-auto overscroll-contain"}
              showToolbar={!compact || isExpanded}
            />
            <div className="flex items-center justify-end gap-2">
              {onCancel && (
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                  Отмена
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="rounded-xl"
                onClick={onSubmit}
                disabled={isSubmitting || !text.trim() || /^\u200b+$/.test(text.trim()) || text.trim() === "\u200b"}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Отправляем
                  </>
                ) : (
                  <>
                    <Send className="mr-1 h-3 w-3" />
                    Ответить
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
