import { act, memo, useEffect, useId, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveReact } from "../context";
import { createLiveViewReactServer } from "../server";
import type {
  LiveViewReactContextValue,
  LiveViewReactRootOptions,
} from "../types";
import { applyPatch } from "../transport/jsonPatch";
import type { EventCommandExecutor } from "./event-callbacks";
import { createIdentifierPrefix } from "./identifier-prefix";
import { RootController, type RootRenderSnapshot } from "./root";

function createContext(
  element: HTMLElement,
  liveSocket: unknown = null,
): LiveViewReactContextValue {
  return {
    el: element,
    liveSocket,
    pushEvent: vi.fn(() =>
      Promise.resolve(undefined),
    ) as unknown as LiveViewReactContextValue["pushEvent"],
    pushEventTo: vi.fn(() => Promise.resolve([])),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };
}

function snapshot(
  props: Record<string, unknown>,
  events: RootRenderSnapshot["events"] = {},
): RootRenderSnapshot {
  return { children: [], events, props };
}

function createController(
  target: HTMLElement,
  initialSnapshot: RootRenderSnapshot,
  options: LiveViewReactRootOptions & {
    readonly hydrate?: boolean;
    readonly hydrationSnapshot?: RootRenderSnapshot;
    readonly executeEventCommands?: EventCommandExecutor;
    readonly liveSocket?: unknown;
  } = {},
) {
  const element = document.createElement("div");
  element.id = "react-root";
  element.append(target);
  const {
    executeEventCommands = vi.fn(),
    liveSocket = null,
    ...rootOptions
  } = options;

  return new RootController({
    ...rootOptions,
    componentName: "Stateful",
    context: createContext(element, liveSocket),
    element,
    executeEventCommands,
    hydrate: options.hydrate === true,
    initialSnapshot,
    target,
  });
}

describe("RootController", () => {
  beforeEach(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("updates the existing root without losing component-local state", async () => {
    function Stateful({ label }: { readonly label: string }) {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          {label}:{count}
        </button>
      );
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({ label: "first" }));

    await act(async () => controller.mount(Stateful));
    await act(async () => target.querySelector("button")?.click());
    await act(async () => controller.update(snapshot({ label: "second" })));

    expect(target.textContent).toBe("second:1");
    await act(async () => controller.destroy());
  });

  it("preserves unchanged prop references so React.memo skips child work", async () => {
    const childRender = vi.fn();
    const stable = { label: "stable" };
    const initialProps = { dynamic: { count: 1 }, stable };
    const nextProps = applyPatch(initialProps, [
      { op: "replace", path: "/dynamic/count", value: 2 },
    ]);

    const MemoChild = memo(function MemoChild({
      value,
    }: {
      value: typeof stable;
    }) {
      childRender();
      return <span>{value.label}</span>;
    });

    function Parent({
      dynamic,
      stable: stableValue,
    }: {
      readonly dynamic: { readonly count: number };
      readonly stable: typeof stable;
    }) {
      return (
        <div>
          <MemoChild value={stableValue} />
          <output>{dynamic.count}</output>
        </div>
      );
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot(initialProps));

    await act(async () => controller.mount(Parent));
    await act(async () => controller.update(snapshot(nextProps)));

    expect(target.querySelector("output")?.textContent).toBe("2");
    expect(childRender).toHaveBeenCalledTimes(1);
    await act(async () => controller.destroy());
  });

  it("keeps event callbacks stable and invalidates stale references", async () => {
    const exec = vi.fn();
    const render = vi.fn();
    let retained: ((payload?: Record<string, unknown>) => void) | undefined;
    const EventProbe = memo(function EventProbe({
      onIncrement,
    }: {
      readonly onIncrement: (payload?: Record<string, unknown>) => void;
    }) {
      render();
      retained = onIncrement;
      return <button onClick={() => onIncrement({ client: 2 })}>run</button>;
    });
    const initialEvents = {
      onIncrement: [["push", { event: "increment", value: { static: 1 } }]],
    } as const;
    const target = document.createElement("div");
    const controller = createController(target, snapshot({}, initialEvents), {
      executeEventCommands: exec,
    });

    await act(async () => controller.mount(EventProbe));
    const first = retained!;
    await act(async () => controller.update(snapshot({}, initialEvents)));

    expect(retained).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);

    await act(async () => target.querySelector("button")?.click());
    expect(exec).toHaveBeenCalledWith([
      ["push", { event: "increment", value: { static: 1, client: 2 } }],
    ]);

    const changedEvents = {
      onIncrement: [["push", { event: "increment-v2" }]],
    } as const;
    await act(async () => controller.update(snapshot({}, changedEvents)));
    const changed = retained!;
    expect(changed).not.toBe(first);
    expect(render).toHaveBeenCalledTimes(2);

    first();
    expect(exec).toHaveBeenCalledTimes(1);

    await act(async () => controller.destroy());
    changed();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("unmounts effects exactly once when destroy is repeated", async () => {
    const cleanup = vi.fn();
    function Effectful() {
      useEffect(() => cleanup, []);
      return null;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}));

    await act(async () => controller.mount(Effectful));
    await act(async () => {
      controller.destroy();
      controller.destroy();
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("balances StrictMode effect setup and cleanup", async () => {
    const setup = vi.fn();
    const cleanup = vi.fn();
    function Effectful() {
      useEffect(() => {
        setup();
        return cleanup;
      }, []);
      return null;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}), {
      strictMode: true,
    });

    await act(async () => controller.mount(Effectful));
    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(1);

    await act(async () => controller.destroy());
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("places the custom wrapper inside the bridge provider", async () => {
    function Wrapper({ children }: { readonly children: ReactNode }) {
      const { el } = useLiveReact();
      return <section data-owner={el?.id}>{children}</section>;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}), {
      wrapRoot: ({ children, componentName, element }) => (
        <Wrapper>
          <div data-component={componentName} data-element={element?.id}>
            {children}
          </div>
        </Wrapper>
      ),
    });

    await act(async () => controller.mount(() => <p>content</p>));

    expect(target.querySelector("section")?.dataset.owner).toBe("react-root");
    expect(
      target.querySelector("[data-component]")?.getAttribute("data-component"),
    ).toBe("Stateful");
    expect(target.textContent).toBe("content");
    await act(async () => controller.destroy());
  });

  it("hydrates the initial snapshot before flushing a pre-mount update", async () => {
    function Greeting({ label }: { readonly label: string }) {
      return <p>{label}</p>;
    }

    const recoverableError = vi.fn();
    const target = document.createElement("div");
    target.innerHTML = "<p>server</p>";
    const controller = createController(target, snapshot({ label: "latest" }), {
      hydrate: true,
      hydrationSnapshot: snapshot({ label: "server" }),
      onRecoverableError: recoverableError,
    });

    await act(async () => controller.mount(Greeting));

    expect(recoverableError).not.toHaveBeenCalled();
    expect(target.textContent).toBe("latest");
    await act(async () => controller.destroy());
  });

  it("hydrates server useId markup without warnings or replacing its DOM node", async () => {
    function IdentifierProbe() {
      const id = useId();
      return (
        <label htmlFor={id}>
          Label
          <input id={id} defaultValue="server" />
        </label>
      );
    }

    const recoverableError = vi.fn();
    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { IdentifierProbe: { component: IdentifierProbe } },
    });
    target.innerHTML = await server.render({
      component: "IdentifierProbe",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    const serverInput = target.querySelector("input");
    const controller = createController(target, snapshot({}), {
      hydrate: true,
      hydrationSnapshot: snapshot({}),
      onRecoverableError: recoverableError,
    });

    await act(async () => controller.mount(IdentifierProbe));

    const hydratedInput = target.querySelector("input");
    expect(recoverableError).not.toHaveBeenCalled();
    expect(hydratedInput).toBe(serverInput);
    expect(hydratedInput?.id).toContain("liveview-react-react-root-");
    expect(target.querySelector("label")?.htmlFor).toBe(hydratedInput?.id);
    await act(async () => controller.destroy());
  });

  it("switches event callbacks from hydration failures to the live executor", async () => {
    const callbacks: Array<() => void> = [];
    const exec = vi.fn();
    const events = {
      onIncrement: [["push", { event: "increment" }]],
    } as const;
    function EventProbe({ onIncrement }: { readonly onIncrement: () => void }) {
      callbacks.push(onIncrement);
      return <button>increment</button>;
    }

    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { EventProbe: { component: EventProbe } },
    });
    target.innerHTML = await server.render({
      component: "EventProbe",
      events,
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    callbacks.length = 0;
    const controller = createController(target, snapshot({}, events), {
      hydrate: true,
      hydrationSnapshot: snapshot({}, events),
      executeEventCommands: exec,
    });

    await act(async () => controller.mount(EventProbe));

    expect(() => callbacks[0]?.()).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => callbacks.at(-1)?.()).not.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
    await act(async () => controller.destroy());
  });

  it("uses server-visible context during hydration before publishing the live bridge", async () => {
    function ContextProbe() {
      const context = useLiveReact();
      contexts.push(context);
      return <p>{context.el?.id ?? "server"}</p>;
    }

    const contexts: LiveViewReactContextValue[] = [];
    const recoverableError = vi.fn();
    const wrapRoot = vi.fn(({ children }) => children);
    const target = document.createElement("div");
    target.innerHTML = "<p>server</p>";
    const controller = createController(target, snapshot({}), {
      hydrate: true,
      hydrationSnapshot: snapshot({}),
      onRecoverableError: recoverableError,
      wrapRoot,
    });

    await act(async () => controller.mount(ContextProbe));

    expect(recoverableError).not.toHaveBeenCalled();
    expect(wrapRoot.mock.calls[0]?.[0].element).toBeNull();
    expect(wrapRoot.mock.calls.at(-1)?.[0].element?.id).toBe("react-root");
    expect(contexts[0]?.el).toBeNull();
    expect(contexts[0]?.liveSocket).toBeNull();
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(() => contexts[0]?.pushEvent("event")).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.pushEventTo("#target", "event")).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.handleEvent("event", () => undefined)).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.removeHandleEvent(null)).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.upload("upload", [])).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.uploadTo("#target", "upload", [])).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(contexts.at(-1)?.el?.id).toBe("react-root");
    expect(() => contexts.at(-1)?.pushEvent("event")).not.toThrow();
    expect(target.textContent).toBe("react-root");
    await act(async () => controller.destroy());
  });
});
