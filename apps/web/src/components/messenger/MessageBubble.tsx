import { memo, useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertCircle, Pin, PinOff } from "lucide-react";
import { formatTime } from "./utils";
import type { MessageView } from "./types";

const PENDING_TIMEOUT_MS = 8_000;

interface MessageBubbleProps {
  message: MessageView;
  isMine: boolean;
  onRetry?: (message: MessageView) => void;
  onTogglePin?: (message: MessageView) => void;
  isPinned?: boolean;
  isConsecutive?: boolean;
}

export const MessageBubble = memo(function MessageBubble({ message, isMine, onRetry, onTogglePin, isPinned, isConsecutive }: MessageBubbleProps) {
  const [showPendingWarning, setShowPendingWarning] = useState(false);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    if (message.localStatus !== "pending") {
      setShowPendingWarning(false);
      setIsStuck(false);
      return;
    }

    // Show a subtle indicator after 3s
    const warningTimer = setTimeout(() => setShowPendingWarning(true), 3_000);
    // Show "stuck" state after 8s
    const stuckTimer = setTimeout(() => setIsStuck(true), PENDING_TIMEOUT_MS);

    return () => {
      clearTimeout(warningTimer);
      clearTimeout(stuckTimer);
    };
  }, [message.localStatus]);

  const getStatusIcon = () => {
    if (message.localStatus === "pending") {
      if (isStuck) return <RefreshCw size={11} className="status-icon status-stuck" />;
      if (showPendingWarning) return <span className="status-dot status-pending-slow" />;
      return <span className="status-dot status-pending" />;
    }
    if (message.peerReadAt) return <span className="status-double-check is-read">&#x2713;&#x2713;</span>;
    if (message.peerDeliveredAt) return <span className="status-double-check">&#x2713;&#x2713;</span>;
    return <span className="status-check">&#x2713;</span>;
  };

  const handleTogglePin = useCallback(() => {
    onTogglePin?.(message);
  }, [onTogglePin, message]);

  return (
    <div className={`bubble-row${isMine ? " is-mine" : ""}${isConsecutive ? " is-consecutive" : ""}`}>
      <div
        className={`message-bubble ${isMine ? "is-mine" : ""} ${isStuck ? "is-stuck" : ""} ${showPendingWarning ? "is-pending-slow" : ""} ${isPinned ? "is-pinned" : ""}`}
        data-message-id={message.id}
      >
        {isMine && isStuck && onRetry ? (
          <div className="message-error-header">
            <AlertCircle size={12} />
            <span>Не отправлено</span>
          </div>
        ) : null}
        <p>{message.plainText}</p>
        <div className="message-meta">
          <span>{formatTime(message.sent_at)}</span>
          {isMine ? (
            <span className="message-status">
              {isStuck ? (
                <button
                  type="button"
                  className="retry-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry?.(message);
                  }}
                  title="Повторить отправку"
                >
                  <RefreshCw size={11} />
                </button>
              ) : (
                getStatusIcon()
              )}
            </span>
          ) : null}
        </div>
        {onTogglePin ? (
          <button
            type="button"
            className="pin-button"
            onClick={handleTogglePin}
            title={isPinned ? "Открепить" : "Закрепить"}
          >
            {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        ) : null}
      </div>
    </div>
  );
});
