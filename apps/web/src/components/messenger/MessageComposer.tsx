import { memo, useCallback, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { SendHorizontal } from "lucide-react";

const MAX_LENGTH = 4000;
const TYPING_DEBOUNCE_MS = 2000;

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
  const [wasTyping, setWasTyping] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= MAX_LENGTH) setDraft(value);

      // Typing indicator
      if (onTyping) {
        if (value.length > 0 && !wasTyping) {
          setWasTyping(true);
          onTyping(true);
        }
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => {
          setWasTyping(false);
          onTyping(false);
        }, TYPING_DEBOUNCE_MS);
      }
    },
    [setDraft, onTyping, wasTyping],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onSend();
        // Clear typing
        if (onTyping) onTyping(false);
        setWasTyping(false);
      }
    },
    [onSend, onTyping],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isSending && draft.trim()) {
        onSend();
        if (onTyping) onTyping(false);
        setWasTyping(false);
      }
    },
    [onSend, isSending, draft, onTyping],
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
