# Slots

LiveViewReact transports HEEx slot output as inert HTML fragments.

## Default and named slots

The default HEEx slot becomes React `children`:

```heex
<.react id="card" component="Card" socket={@socket}>
  <p>Server content</p>
</.react>
```

```tsx
function Card({ children }: { readonly children?: React.ReactNode }) {
  return <section>{children}</section>;
}
```

Named HEEx slots become same-name React props:

```heex
<.react id="dialog" component="Dialog" socket={@socket}>
  <:header><strong>Header</strong></:header>
  Body
</.react>
```

```tsx
function Dialog({
  children,
  header,
}: {
  readonly children?: React.ReactNode;
  readonly header?: React.ReactNode;
}) {
  return (
    <section>
      <header>{header}</header>
      <main>{children}</main>
    </section>
  );
}
```

The runtime wraps each transported slot in an inert `<div>` marked with
`data-liveview-react-slot`. The wrapper and its React key stay structurally
stable across SSR, hydration, and live updates. Account for that `<div>` when
placing a slot in markup with strict content models, such as tables.

Conditional named slots update and disappear without leaving stale HTML. A
disappeared slot is an empty React node; components should render the prop
normally or use `React.Children.count()` rather than relying on own-property
presence.

## Constraints

Slots are for inert HTML only. LiveViewReact rejects slot markup that would
require Phoenix or React to own a nested interactive subtree:

- `<form ...>`
- `phx-*` or `data-phx-*` attributes
- `phx-hook`
- nested LiveComponents
- nested LiveViewReact roots

These validations run during server rendering and again in the browser runtime.
They define an interoperability boundary, not an HTML sanitizer. Dynamic HEEx
values are safe because Phoenix escapes them before LiveViewReact encodes the
rendered slot. Do not construct SSR render requests with untrusted raw HTML or
mark untrusted values as `Phoenix.HTML.Safe`.

## Collisions

Ordinary props cannot share a name with a transported slot:

- default slot collides with `children`
- named slot `:header` collides with prop `header`

LiveViewReact raises immediately instead of choosing one source implicitly.
