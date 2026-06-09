import { memo, useCallback, useRef, type KeyboardEvent, type RefObject } from "react";
import { SendHorizontal } from "lucide-react";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 500;

interface Props {
  draft: string;
  setDraft: (value: string) => void;
  isSending: boolean;
  onSend: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onTyping?: (isTyping: boolean) => void;
}

export const MessageComposer = memo(function MessageComposer({
  draft,
  setDraft,
  isSending,
  onSend,
  composerRef,
  onTyping,
}: Props) {
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping?.(false);
    }
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
  }, [onTyping]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_LENGTH) setDraft(value);

      // Typing indicator — instant start via ref, debounced stop
      if (onTyping && value.length > 0) {
        if (!isTypingRef.current) {
          isTypingRef.current = true;
          onTyping(true);
        }
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => {
          isTypingRef.current = false;
          onTyping(false);
          typingTimer.current = null;
        }, TYPING_DEBOUNCE_MS);
      } else if (onTyping) {
        // Value is empty — stop typing immediately (e.g. backspaced all text)
        stopTyping();
      }
    },
    [setDraft, onTyping],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        stopTyping();
        onSend();
      }
    },
    [onSend, stopTyping],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isSending && draft.trim()) {
        stopTyping();
        onSend();
      }
    },
    [onSend, isSending, draft, stopTyping],
  );

  const remaining = MAX_LENGTH - draft.length;
  const canSend = !isSending && draft.trim().length > 0;

  return (
    <form className={`composer${isSending ? " is-sending" : ""}`} onSubmit={handleSubmit}>
      <div className="composer-input-wrap">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Напиши сообщение..."
          maxLength={MAX_LENGTH}
          rows={1}
        />
        {remaining < 100 && draft.length > 0 && (
          <span className={`composer-counter ${remaining < 20 ? "is-critical" : ""}`}>
            {remaining}
          </span>
        )}
      </div>
      <button type="submit" className="send-button" disabled={!canSend}>
        <SendHorizontal size={16} />
      </button>
    </form>
  );
});
