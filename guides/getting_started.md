# Getting started

LiveViewReact mounts a normal React 19 tree inside a Phoenix LiveView without
creating another socket or moving server state into the browser. Each
`<.react>` call is one independent React root.

## Install the bridge

From the Phoenix application root, run:

```sh
mix igniter.install liveview_react
```

The installer adds the Hex package, a local asset dependency pointing at
`deps/liveview_react`, PhoenixVite, TypeScript, the browser and SSR entry
points, and a component registry. Use `--bun` for the PhoenixVite Bun runner
or `--no-demo` to skip the example route. In an umbrella, run it from the
Phoenix child application.

See [Installation](installation.md) for the exact generated-file contract and
manual setup notes.

## Add a React component

Create `assets/react-components/Counter.tsx` with a default export:

```tsx
import { useState } from "react";
import { useLiveViewReact } from "liveview_react";

type CounterProps = {
  readonly count: number;
};

type IncrementReply =
  | { readonly count: number }
  | { readonly error: string };

export default function Counter({ count }: CounterProps) {
  const [draft, setDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { pushEvent } = useLiveViewReact();

  async function increment() {
    setErrorMessage(null);

    try {
      const reply = await pushEvent<IncrementReply>("increment", { by: 1 });
      if ("error" in reply) setErrorMessage(reply.error);
    } catch {
      setErrorMessage("The server could not process the increment");
    }
  }

  return (
    <section>
      <p>Server count: {count}</p>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button
        type="button"
        onClick={() => void increment()}
      >
        Increment
      </button>
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </section>
  );
}
```

The default virtual registry names a component by its extensionless path below
`assets/react-components`; this file is registered as `Counter`.

## Render it from LiveView

Import `LiveViewReact` from the application's web helpers, then render the
component with a stable ID, its registry name, and the current socket:

```heex
<.react
  id="account-counter"
  component="Counter"
  socket={@socket}
  count={@count}
/>
```

Handle the event with normal LiveView code:

```elixir
def handle_event("increment", %{"by" => by}, socket)
    when is_integer(by) and by in 1..10 do
  socket = update(socket, :count, &(&1 + by))
  {:reply, %{count: socket.assigns.count}, socket}
end

def handle_event("increment", _invalid_payload, socket) do
  {:reply, %{error: "increment must be an integer from 1 through 10"}, socket}
end
```

Validate event payloads as you would for any other client input.

## Choose the state owner

Use LiveView assigns for authoritative application state: persisted data,
authorization decisions, validation results, navigation state, and anything
another client or process can change. Pass that state into React as props.

Use React state for interaction that is local to this mounted root: an open
popover, an unfinished text draft, selection, focus, animation, or a
third-party widget's transient state. A normal server prop update rerenders the
existing root and preserves that local state. Removing the `<.react>` element,
changing its `id`, or replacing its `component` creates a state boundary and
must be treated as a remount.

Two `<.react>` elements never share a React root or Context automatically. If
two roots need the same authoritative value, keep it in LiveView and pass it to
both. If they require one shared client-side Context, they belong in one larger
React component tree.

## Continue

- [Component API](component_api.md) covers HEEx assigns, registries, factory
  options, and errors.
- [Client hooks](client_hooks.md) covers events, connection state, navigation,
  forms, and uploads.
- [Architecture](architecture.md) explains ownership and lifecycle boundaries.
- [SSR](ssr.md) covers development and production rendering.
- [Testing](testing.md) shows how to inspect roots and run the browser suite.
- [Limitations](limitations.md) records the deliberate slot, hydration,
  production SSR, and supported-browser boundaries.
