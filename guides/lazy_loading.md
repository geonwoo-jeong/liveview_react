# Lazy loading

LiveViewReact supports code-split registry entries and ordinary React
`lazy`/`Suspense` trees. These solve different loading problems.

## Lazy registry entry

Use a tagged loader when the whole root component should be a separate chunk:

```tsx
import Counter from "./Counter";

export const components = {
  Counter: { component: Counter },
  Editor: { load: () => import("./Editor") },
} as const;
```

The tag is required. `{ component: Counter }` is eager; `{ load: loader }` is
lazy. LiveViewReact never guesses whether a zero-argument function is a React
component or an import function. A loader must resolve to a module with a valid
default React export.

Create the browser and server factories from the same registry. SSR awaits the
loader before rendering. If the browser receives updates before the import
finishes, the runtime keeps the latest immutable snapshot and mounts once with
that state. If LiveView removes the root first, the completed import is ignored
and no root is mounted.

The bridge-level loader has no loading-fallback option because React has not
mounted the component tree yet. A rejected import is reported as an
asynchronous load error and cannot be caught by an Error Boundary inside that
unmounted root.

## Visible Suspense fallback

Use an eager root shell and React's normal `lazy` and `Suspense` when the page
needs a fallback or an Error Boundary:

```tsx
import { lazy, Suspense } from "react";

const Editor = lazy(() => import("./Editor"));

export default function EditorRoot() {
  return (
    <EditorErrorBoundary>
      <Suspense fallback={<p>Loading editor…</p>}>
        <Editor />
      </Suspense>
    </EditorErrorBoundary>
  );
}
```

This is standard React behavior inside one root. Context, transitions, event
propagation, and the Error Boundary remain in the same component tree.

## Virtual registry behavior

`virtual:liveview-react/components` intentionally imports discovered default
exports eagerly. It gives the browser and SSR entry points one deterministic
file-based registry, but it does not infer chunk boundaries. Applications that
need bridge-level splitting should maintain an explicit tagged registry or
keep an eager shell in the virtual registry and lazy-load below it.

Vite handles JavaScript and CSS chunks referenced by `import()`. LiveViewReact
does not currently inspect a production manifest or emit automatic
component-chunk preload links. React 19 resource hints explicitly returned by
the component during SSR remain in the rendered HTML.

## Identity and navigation

Keep the `<.react>` ID and component name stable while a lazy load is pending.
Normal prop patches do not restart the import. Navigation or conditional
rendering that removes the root cancels the pending mount logically; JavaScript
module fetching itself is not aborted. Returning later creates a new root and
starts that root's loader lifecycle.

Test delayed resolution, rejection, update-before-resolution, and
remove-before-resolution in the application's real navigation flow. The
repository Playwright suite covers the bridge race behavior; application tests
should cover their own chunk and fallback UI.
