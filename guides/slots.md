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

Named slots use the reserved `<:slot>` entry and become same-name React props:

```heex
<.react id="dialog" component="Dialog" socket={@socket}>
  <:slot name="header"><strong>Header</strong></:slot>
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

### Why named slots carry an explicit `name`

HEEx hands a function component one flat assigns map in which attributes and
slots share a namespace, and it renders a slot omitted by `:if` as `[]` — the
same value as an ordinary empty list attribute. Nothing at runtime tells the two
apart, so a component that guessed would sooner or later transport a hidden slot
as a stray prop.

Routing every named slot through the reserved `:slot` assign removes the guess:
slot identity comes from the assign name, never from the shape of a value.
`items={[]}` therefore stays an ordinary prop holding an empty list, and

```heex
<:slot :if={@show} name="header">…</:slot>
```

contributes nothing at all while `@show` is false.

The runtime wraps each transported slot in an inert `<div>` marked with
`data-liveview-react-slot`. The wrapper and its React key stay structurally
stable across SSR, hydration, and live updates. Account for that `<div>` when
placing a slot in markup with strict content models, such as tables.

Repeated `<:slot>` entries that share a `name` are concatenated in HEEx order,
matching Phoenix's own repeated-slot behaviour.

Meaningful leading and trailing whitespace is preserved exactly. A slot that
contains only HTML whitespace is omitted instead of creating an empty wrapper.

Conditional named slots update and disappear without leaving stale HTML. A
disappeared slot is absent from props entirely, so `header ?? fallback` and
`React.Children.count(header)` both behave as expected.

`name` must be lower camelCase or snake_case. `"default"` and `"children"` are
reserved for the element body, which always arrives as React `children`.

## Constraints

Slots are for inert HTML only. The server and browser both apply the same
fail-closed tag and attribute allowlist before inserting a fragment. The
allowlist covers passive structure, text, lists, and tables, including tags
such as `div`, `span`, headings, `p`, `strong`, `code`, `section`, `ul`, and
`table`. It accepts presentation-neutral metadata such as `class`, `id`,
`role`, `aria-*`, non-reserved `data-*`, language, list, and table attributes.

Everything else is rejected. In particular, a slot cannot contain:

- active or resource-bearing tags such as `a`, `button`, `input`, `form`,
  `img`, `script`, `style`, `iframe`, SVG, or custom elements
- inline event handlers, `style`, or URL-bearing attributes
- `phx-*` or `data-phx-*` attributes
- `phx-hook`
- nested LiveComponents
- nested LiveViewReact roots

These validations run during server rendering and again in the browser runtime.
They reject unsupported markup rather than rewriting it and are not a general
HTML sanitizer. Dynamic HEEx values are safe because Phoenix escapes them before
LiveViewReact encodes the rendered slot. Do not construct SSR render requests
with untrusted raw HTML or mark untrusted values as `Phoenix.HTML.Safe`.

## Collisions

Ordinary props cannot share a name with a transported slot:

- default slot collides with `children`
- named slot `:header` collides with prop `header`

LiveViewReact raises immediately instead of choosing one source implicitly.
