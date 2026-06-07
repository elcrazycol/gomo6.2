import { memo, type RefObject, useCallback, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";

const MAX_MESSAGE_LENGTH = 4000;

interface MessageComposerProps {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  sendMessage: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}

export const MessageComposer = memo(function MessageComposer({
  draft,
  setDraft,
  sending,
  sendMessage,
  composerRef,
}: MessageComposerProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Ignore Enter during IME composition (Japanese, Chinese, Korean input)
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (value.length <= MAX_MESSAGE_LENGTH) {
        setDraft(value);
      }
    },
    [setDraft]
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      sendMessage();
    },
    [sendMessage]
  );

  const remaining = MAX_MESSAGE_LENGTH - draft.length;
  const canSend = !sending && draft.trim().length > 0;

  return (
    <form className={`composer${sending ? " is-sending" : ""}`} onSubmit={handleSubmit}>
      <div className="composer-input-wrap">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Напиши сообщение..."
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
        />
        {remaining < 100 && draft.length > 0 ? (
          <span className={`composer-counter ${remaining < 20 ? "is-critical" : ""}`}>
            {remaining}
          </span>
        ) : null}
      </div>
      <button type="submit" className="send-button" disabled={!canSend}>
        <SendHorizontal size={16} />
      </button>
    </form>
  );
});

