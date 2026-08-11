import { useEffect, useState, type FocusEvent } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GomoRichEditor } from "@/components/GomoRichEditor";

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
}

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
}: WallCommentComposerProps) => {
  const [expanded, setExpanded] = useState(!focusToExpand);
  const isExpanded = !focusToExpand || expanded || Boolean(text.trim());

  // After a successful submit the parent clears the draft and bumps resetKey —
  // fold the composer back into its quiet one-line prompt.
  useEffect(() => {
    if (focusToExpand && !text.trim()) {
      setExpanded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Collapse on blur only while the draft is empty — never swallow typed text.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (focusToExpand && !text.trim() && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setExpanded(false);
    }
  };

  if (focusToExpand && !isExpanded) {
    return (
      <button
        type="button"
        className="group flex min-h-11 w-full items-center gap-2 rounded-2xl border border-border/70 bg-background/80 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded(true)}
        aria-label={placeholder}
      >
        <Sparkles className="h-4 w-4 text-primary/70 transition-transform group-hover:rotate-12" />
        <span>{placeholder}…</span>
      </button>
    );
  }

  return (
    <div
      onBlur={handleBlur}
      className={`space-y-2 rounded-2xl border border-border/70 bg-background/90 p-2 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none ${compact ? "" : "p-3"}`}
    >
      <GomoRichEditor
        autoFocus={autoFocus}
        resetKey={resetKey}
        maxLength={maxLength}
        contentJson={json}
        legacyContent={text}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        minHeightClassName={compact ? "min-h-[60px]" : "min-h-[84px]"}
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
  );
};
