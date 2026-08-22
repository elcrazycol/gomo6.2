import { useEffect, useRef, type FocusEvent, type Ref } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { useComposerExpand } from "@/hooks/useComposerExpand";

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
  /** Mobile: the expanded editor stays a small pill — one line, no toolbar, an
      icon-only send button — instead of the full composer box. */
  minimal?: boolean;
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
  minimal = false,
  focusToExpand = false,
  autoFocus = false,
  replyTo = null,
  editorRef,
}: WallCommentComposerProps) => {
  // Shared pill ↔ expanded state machine (expand on tap, collapse on
  // blur-while-empty / after submit, keep open with text or a reply target).
  const { expanded, closing, isExpanded, showBox, expand, requestCollapse } = useComposerExpand({
    focusToExpand,
    text,
    replyTo,
    resetKey,
  });
  // The minimal layout only makes sense for the expand-on-focus pill.
  const isMinimal = minimal && focusToExpand;
  const canSubmit =
    !isSubmitting &&
    Boolean(text.trim()) &&
    !/^\u200b+$/.test(text.trim()) &&
    text.trim() !== "\u200b";

  // First-open caret fix (minimal bar on touch). On the VERY first open the
  // custom font can still be downloading: the caret is laid out against
  // fallback-font metrics and, once the real font swaps in, keeps its stale
  // rect — it reads as sitting in the middle of the text instead of after it.
  // On the second open the font is cached, so the problem vanishes (see the
  // font realignment in GomoRichEditor). That realignment can miss here
  // because the minimal bar mounts while the pill expands and the keyboard
  // slides in, so nudge the caret to the end once everything has settled.
  const caretNudgedOnceRef = useRef(false);
  useEffect(() => {
    if (!isMinimal || !expanded || caretNudgedOnceRef.current) return;
    caretNudgedOnceRef.current = true;
    const handle = editorRef && typeof editorRef === "object" && "current" in editorRef ? editorRef.current : null;
    const editor = handle?.getEditor ? handle.getEditor() : null;
    if (!editor) return;
    const timer = window.setTimeout(() => {
      // Skip if the composer was blurred/collapsed or destroyed meanwhile —
      // refocusing a hidden editor would summon the keyboard back up.
      if (editor.isDestroyed || !editor.isFocused) return;
      // scrollIntoView:false — a focus() here defaults to scrolling the
      // editor into view, which would fight the keyboard pin right after
      // open (the "teleport" the pin is there to prevent).
      editor.commands.focus("end", { scrollIntoView: false });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [isMinimal, expanded, editorRef]);

  // Collapse on blur only while the draft is empty — never swallow typed text.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (focusToExpand && !text.trim() && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      requestCollapse();
    }
  };

  const editorPlaceholder = replyTo ? "Напишите ответ" : placeholder;
  const pillLabel = replyTo ? `Ответ для @${replyTo.name}…` : `${placeholder}…`;

  // Collapsed: just the quiet one-line prompt.
  if (focusToExpand && !showBox) {
    return <Pill label={pillLabel} onClick={expand} />;
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
          onClick={expand}
          hidden={underlayHidden}
          className={`absolute inset-x-0 bottom-0 transition-opacity ${underlayHidden ? "pointer-events-none opacity-0" : "opacity-100"}`}
        />
      )}
      <div
        onBlur={handleBlur}
        className={`relative z-10 grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${closing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`${
              isMinimal
                // The minimal bar is a row: [input pill] [send button]. No
                // border/background here — the pill carries them. Also NO
                // zoom/animate transform: a transform on (or near) the
                // contenteditable breaks the iOS caret position (it floats to
                // the middle of the text instead of sitting after the letter).
                ? "flex items-center gap-1.5 p-1"
                : `space-y-2 rounded-2xl border border-border/70 bg-background p-2 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none ${compact ? "" : "p-3"}`
            }`}
          >
            {isMinimal ? (
              <>
                <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-2xl border border-border/70 bg-background py-1 pl-3 pr-1.5 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md">
                  {replyTo && (
                    <button
                      type="button"
                      onClick={onCancel}
                      aria-label="Отменить ответ"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {/* min-w-0 flex-1: the editor always fills the pill and text
                      wraps inside it, so the send button stays pinned at the
                      right edge instead of being pushed by what you type. */}
                  <div className="min-w-0 flex-1">
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
                      minHeightClassName="min-h-[28px]"
                      maxHeightClassName="max-h-[30vh] overflow-y-auto overscroll-contain"
                      showToolbar={false}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  aria-label="Отправить"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </>
            ) : (
              <>
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
                    disabled={!canSubmit}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
