# Choosing an architecture

LiveViewReact is useful when LiveView should remain the application runtime but
one part of a page benefits from React. It is not a requirement for every
Phoenix UI and it is not a SPA framework.

## Decision table

| Need | Pure LiveView | LiveViewReact | Inertia or SPA |
| --- | --- | --- | --- |
| Server-rendered HTML with minimal JavaScript | Best fit | Adds unnecessary runtime cost | Usually more client infrastructure |
| Phoenix owns routing, authorization, and remote state | Native | Native; React receives props and uses the same socket | Requires an explicit server/client data contract |
| One complex React widget or React-only library | Requires custom hooks or replacement | Best fit | Works, but broadens the architecture |
| Shared React Context across the whole page | Not applicable | Only inside each independent root | Natural in one application root |
| Browser owns routing and most remote fetching | Poor fit | Intentionally not provided | Best fit |
| Progressive enhancement without React | Best fit | Use only for selected roots | Usually not the primary model |

## Pure LiveView

Choose pure LiveView when HEEx, function components, LiveComponents, streams,
and small JavaScript hooks express the interface clearly. It has fewer client
dependencies, one rendering model, and direct Phoenix semantics. Do not insert
React merely to wrap static markup or a simple event handler.

## LiveViewReact

Choose LiveViewReact for a bounded component tree that needs normal React 19
semantics: local interactive state, Context within that tree, portals,
Suspense, transitions, controlled inputs, canvas/WebGL, or a compatible React
library. LiveView continues to own navigation, reconnect, server events,
uploads, validation results, and authoritative state.

Each `<.react>` is a separate root. Several small roots are appropriate for
independent widgets. If those widgets need shared client state or Context,
prefer one larger root instead of inventing a cross-root synchronization layer.

## Inertia or a client SPA

Choose Inertia or a conventional React SPA when React should own the page
shell, routing transitions, client cache, and most data-fetching behavior. That
model can be simpler than forcing a page-scale React application through many
LiveView roots. It also changes deployment, error handling, authorization
boundaries, and test strategy, so make the choice at the application level.

## Other LiveView frontend bridges

LiveVue and LiveSvelte apply a similar server-owned-page idea to different
frontend runtimes. Choose the bridge that matches the component ecosystem and
team expertise. Their component registries, SSR tools, slot semantics, and
state APIs are not compatibility contracts for LiveViewReact.
