import { Suspense, ComponentType, memo, Component, type ReactNode } from 'react';
import { PentagramLoader } from './PentagramLoader';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logClientError } from '@/lib/logging';

interface LazyPageProps {
  component: ComponentType;
}

interface LazyErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class LazyErrorBoundary extends Component<{ children: ReactNode }, LazyErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): LazyErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    logClientError(error, 'lazy_page_error_boundary');
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold">Не удалось загрузить страницу</h1>
            <p className="text-muted-foreground">
              Возможно, приложение обновилось или соединение прервалось.
              Попробуйте перезагрузить страницу.
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md p-3 font-mono">
                {this.state.error.message}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={this.handleRetry}>
                Попробовать снова
              </Button>
              <Button onClick={this.handleReload}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Перезагрузить
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const LazyPage = memo(({ component: Component }: LazyPageProps) => (
  <Suspense
    fallback={
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    }
  >
    <LazyErrorBoundary>
      <Component />
    </LazyErrorBoundary>
  </Suspense>
));
