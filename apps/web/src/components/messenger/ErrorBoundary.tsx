import { Component, type ErrorInfo, type ReactNode } from "react";
import { MessageCircle, RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Whole-messenger fallback. Deliberately compact: a broken widget must read as
 * one quiet row, not a full-screen banner (the previous version covered the
 * entire workspace with a hero and two paragraphs).
 */
export class MessengerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[MessengerErrorBoundary] Caught error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="messenger-app">
          <div className="messenger-shell">
            <div className="messenger-crash" role="alert">
              <MessageCircle size={18} />
              <div className="messenger-crash-copy">
                <strong>Мессенджер не открылся</strong>
                <span>{this.state.error?.message || "Неизвестная ошибка"}</span>
              </div>
              <button type="button" className="messenger-crash-retry" onClick={this.handleRetry}>
                <RotateCw size={13} />
                Повторить
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface ContentBoundaryProps {
  children: ReactNode;
}

interface ContentBoundaryState {
  failed: boolean;
}

/**
 * Per-message boundary. A single malformed card (a share preview with an odd
 * payload, a media element the browser refuses) is contained to its own bubble:
 * the bubble stays in place with a short "не удалось показать" line, and the
 * chat, the composer and every other message keep working.
 *
 * Deliberately a class: error boundaries have no hook equivalent.
 */
export class MessageContentBoundary extends Component<ContentBoundaryProps, ContentBoundaryState> {
  constructor(props: ContentBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): ContentBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[MessageContent] render failed:", error, errorInfo);
  }

  render() {
    if (this.state.failed) {
      return <span className="message-content-fallback">Не удалось показать сообщение</span>;
    }
    return this.props.children;
  }
}
