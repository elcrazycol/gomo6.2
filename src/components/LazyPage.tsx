import { Suspense, ComponentType } from 'react';
import { PentagramLoader } from './PentagramLoader';

interface LazyPageProps {
  component: ComponentType;
}

export const LazyPage = ({ component: Component }: LazyPageProps) => (
  <Suspense
    fallback={
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    }
  >
    <Component />
  </Suspense>
);