# Events

LiveViewReact supports programmatic events, server-pushed events, Phoenix JS
callback props, and normal `phx-*` bindings rendered by React.

## Programmatic events

```tsx
const { pushEvent } = useLiveReact();
const reply = await pushEvent<{ count: number }>("increment", { by: 1 });
```

See [Client hooks](client_hooks.md) for subscriptions, reply state, connection
state, and navigation.

## Phoenix JS callback props

Declare a callback with a lowercase kebab-case `r-on:*` attribute:

```heex
<.react
  id="counter"
  component="Counter"
  socket={@socket}
  r-on:increment={
    JS.transition("opacity-50", to: "#status")
    |> JS.push("increment",
      target: "#counter-component",
      loading: "#status",
      value: %{source: "server"}
    )
  }
/>
```

The attribute becomes an `onCamelCase` React prop:

```tsx
type CounterProps = {
  readonly onIncrement: (payload?: {
    readonly by: number;
  }) => void;
};

function Counter({ onIncrement }: CounterProps) {
  return (
    <button type="button" onClick={() => onIncrement({ by: 2 })}>
      Increment
    </button>
  );
}
```

The value must be a `Phoenix.LiveView.JS` command or `nil`. An ordinary prop
with the generated callback name is an error. Callback metadata is transported
separately from ordinary props and is validated during live rendering, SSR,
and hydration.

The optional callback payload must be a plain JSON object. For every `JS.push`
in the command chain, payload fields override fields with the same names in
the static `value:` option. Other transition, target, loading, DOM, and
navigation commands remain in their original order. Inputs and commands are
copied rather than mutated.

Unchanged command chains retain the same function reference. Replaced,
removed, or destroyed callbacks become inert, including references retained
outside the React tree. Invoking a callback during SSR or hydration throws a
clear error; callbacks become live after hydration commits.

## `phx-*` inside React DOM

Phoenix LiveView delegates its DOM events, so lowercase bindings rendered by
React work directly:

```tsx
<button type="button" phx-click="increment" phx-value-by="1">
  Increment
</button>
```

The npm package includes the React JSX augmentation for `phx-*` attributes.
No wrapper component is required. Phoenix remains responsible for event
targeting, loading classes, and reconnect behavior.
