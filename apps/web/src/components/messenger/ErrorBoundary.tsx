import { Component, type ErrorInfo, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

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
            <div className="empty-thread hero" style={{ gridColumn: "1 / -1" }}>
              <MessageCircle size={18} />
              <h2>Что-то пошло не так</h2>
              <p style={{ maxWidth: 400, marginBottom: 16 }}>
                В мессенджере произошла ошибка. Пожалуйста, попробуй перезагрузить страницу.
              </p>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
                {this.state.error?.message}
              </p>
              <button type="button" className="cta-button" onClick={this.handleRetry}>
                Попробовать снова
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
