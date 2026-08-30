import { lazy, Suspense } from "react";

const LazyComponent = lazy(() => import("./components/lazy-component"));

export default function Lazy() {
  return (
    <div>
      <h1>Hello, Vite with Code Splitting and Lazy Loading!</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <LazyComponent />
      </Suspense>
    </div>
  );
}
