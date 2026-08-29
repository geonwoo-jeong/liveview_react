import {
  createElement,
  isValidElement,
  StrictMode,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLiveViewHook } from "./tests/helpers";
import { createIdentifierPrefix } from "./runtime/identifier-prefix";

const renderMock = vi.fn();
const rootMock = { render: renderMock, unmount: vi.fn() };

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => rootMock),
  hydrateRoot: vi.fn(() => rootMock),
}));

const TestComponent = (_props: Record<string, unknown>) => null;

type TestHook = ReturnType<typeof createMockLiveViewHook>;
type LifecycleCallback = (...args: never[]) => unknown;

function findElement(
  node: ReactNode,
  matches: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child as ReactNode, matches);
      if (match) return match;
    }

    return null;
  }

  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (matches(node)) return node;
  return findElement(node.props.children as ReactNode, matches);
}

function findComponentProps(node: ReactNode): Record<string, unknown> | null {
  return (
    findElement(node, (element) => element.type === TestComponent)?.props ??
    null
  );
}

function lastRenderedProps(render = renderMock): Record<string, unknown> {
  const lastRender = render.mock.calls.at(-1);
  if (!lastRender) throw new Error("Expected the React root to render");

  const props = findComponentProps(lastRender[0] as ReactNode);
  if (!props) throw new Error("Expected to find the test component");
  return props;
}

const OP_CODES = {
  add: "a",
  remove: "d",
  replace: "r",
  upsert: "u",
  limit: "l",
} as const;

type TestPatchOperation = readonly [keyof typeof OP_CODES, string, unknown?];

function encodeValue(value: unknown): string {
  if (value === null) return "z";
  if (value === true) return "b1";
  if (value === false) return "b0";
  if (typeof value === "number") {
    const encoded = String(value);
    return `n${encoded.length}:${encoded}`;
  }
  if (typeof value === "string") return `s${value.length}:${value}`;

  const json = JSON.stringify(value)
    .replace(/~/g, "~~")
    .replace(/\^/g, "~^")
    .replace(/"/g, "^");
  return `J${json.length}:${json}`;
}

function encodePatch(operations: readonly TestPatchOperation[]): string {
  return operations
    .map(([operation, path, value]) => {
      const prefix = `${OP_CODES[operation]}${path.length}:${path}`;
      return operation === "remove" ? prefix : prefix + encodeValue(value);
    })
    .join("");
}

function encodeProps(props: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(props)
    .replace(/~/g, "~~")
    .replace(/\^/g, "~^")
    .replace(/"/g, "^");
}

function hydrationDescriptor(
  rootId: string,
  props: Readonly<Record<string, unknown>> = {},
  slots: Readonly<Record<string, string>> = {},
  component = "TestComponent",
  events: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    component,
    events,
    identifierPrefix: createIdentifierPrefix(rootId),
    props,
    slots,
    version: 1,
  });
}

function invoke(callback: LifecycleCallback, hook: object): void {
  Reflect.apply(callback, hook, []);
}

function createTestHook(
  attributes: Record<string, string> = {},
  targetAttributes: Record<string, string> = {},
  liveSocket?: unknown,
): TestHook {
  return createMockLiveViewHook(
    {
      "data-component": "TestComponent",
      ...attributes,
    },
    targetAttributes,
    liveSocket,
  );
}

function setAttributes(
  hook: TestHook,
  attributes: Readonly<Record<string, string | null>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null) hook.el.removeAttribute(name);
    else hook.el.setAttribute(name, value);
  }
}

describe("LiveViewReactHook", () => {
  let createLiveViewReact: typeof import("./index").createLiveViewReact;
  let liveViewReactHook: ReturnType<
    typeof createLiveViewReact
  >["hooks"]["LiveViewReactHook"];
  let ReactDOM: typeof import("react-dom/client");

  beforeEach(async () => {
    vi.resetModules();
    ReactDOM = await import("react-dom/client");
    ({ createLiveViewReact } = await import("./index"));
    liveViewReactHook = createLiveViewReact({
      components: { TestComponent: { component: TestComponent } },
    }).hooks.LiveViewReactHook;
    vi.clearAllMocks();
  });

  it("creates one root and reuses it across updates and reconnects", () => {
    const hook = createTestHook({
      "data-props": encodeProps({ title: "Initial" }),
    });

    invoke(liveViewReactHook.mounted, hook);
    setAttributes(hook, {
      "data-props": encodeProps({ title: "Updated" }),
      "data-props-kind": "snapshot",
      "data-streams-diff": "",
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);
    invoke(liveViewReactHook.reconnected, hook);

    expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ReactDOM.hydrateRoot)).not.toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(lastRenderedProps().title).toBe("Updated");
  });

  it("mounts only inside the direct React-owned target", () => {
    const hook = createTestHook();

    invoke(liveViewReactHook.mounted, hook);

    expect(hook.el.querySelectorAll).toHaveBeenCalledWith(
      ":scope > [data-react-target]",
    );
    expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledWith(hook.target, {
      identifierPrefix: createIdentifierPrefix(hook.el.id),
    });
    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalledWith(hook.el, {
      identifierPrefix: createIdentifierPrefix(hook.el.id),
    });
  });

  it("rejects an element without a direct React-owned target", () => {
    const hook = createTestHook();
    hook.el.querySelectorAll.mockReturnValue([] as never);

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "requires exactly one direct [data-react-target] child element",
    );
  });

  it("rejects multiple direct React-owned targets", () => {
    const hook = createTestHook();
    hook.el.querySelectorAll.mockReturnValue([
      hook.target,
      document.createElement("div"),
    ] as never);

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "requires exactly one direct [data-react-target] child element",
    );
  });

  it("unmounts immediately and exactly once when destroyed", () => {
    const hook = createTestHook();

    invoke(liveViewReactHook.mounted, hook);
    invoke(liveViewReactHook.destroyed, hook);
    expect(rootMock.unmount).toHaveBeenCalledTimes(1);

    invoke(liveViewReactHook.destroyed, hook);
    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
  });

  it("hydrates when the inner target carries the hydration marker", () => {
    const hook = createTestHook(
      {
        id: "hydration-root",
        "data-props": encodeProps({ title: "Connected" }),
      },
      {
        "data-react-hydration": hydrationDescriptor(
          "hydration-root",
          {
            title: "Server rendered",
          },
          { default: "<strong>server slot</strong>" },
        ),
      },
    );
    hook.target.innerHTML = "<div>Server rendered</div>";

    invoke(liveViewReactHook.mounted, hook);

    expect(vi.mocked(ReactDOM.hydrateRoot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ReactDOM.hydrateRoot).mock.calls[0]?.[0]).toBe(
      hook.target,
    );
    const serverProps = findComponentProps(
      vi.mocked(ReactDOM.hydrateRoot).mock.calls[0]?.[1] as ReactNode,
    );
    expect(serverProps).toMatchObject({ title: "Server rendered" });
    expect(
      isValidElement(serverProps?.children) && serverProps.children.props,
    ).toMatchObject({
      dangerouslySetInnerHTML: { __html: "<strong>server slot</strong>" },
    });
    expect(hook.target.hasAttribute("data-react-hydration")).toBe(false);
    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    [
      "unknown version",
      JSON.stringify({
        component: "TestComponent",
        identifierPrefix: createIdentifierPrefix("malformed-root"),
        props: {},
        slots: {},
        version: 2,
      }),
    ],
    [
      "component mismatch",
      hydrationDescriptor("malformed-root", {}, {}, "AnotherComponent"),
    ],
    [
      "missing identifier prefix",
      JSON.stringify({
        component: "TestComponent",
        props: {},
        slots: {},
        version: 1,
      }),
    ],
    ["identifier prefix mismatch", hydrationDescriptor("another-root")],
    [
      "non-object props",
      JSON.stringify({
        component: "TestComponent",
        identifierPrefix: createIdentifierPrefix("malformed-root"),
        props: [],
        slots: {},
        version: 1,
      }),
    ],
    [
      "invalid slots",
      JSON.stringify({
        component: "TestComponent",
        identifierPrefix: createIdentifierPrefix("malformed-root"),
        props: {},
        slots: { default: 1 },
        version: 1,
      }),
    ],
  ])("rejects a malformed hydration descriptor: %s", (_label, descriptor) => {
    const hook = createTestHook(
      { id: "malformed-root" },
      { "data-react-hydration": descriptor },
    );

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow();
  });

  it("preserves JSON values while passing only server props", () => {
    const hook = createTestHook({
      "data-props": encodeProps({
        count: 0,
        enabled: false,
        label: "",
        selection: null,
      }),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(lastRenderedProps()).toMatchObject({
      count: 0,
      enabled: false,
      label: "",
      selection: null,
    });
    expect(lastRenderedProps()).not.toHaveProperty("pushEvent");
    expect(lastRenderedProps()).not.toHaveProperty("pushEventTo");
    expect(lastRenderedProps()).not.toHaveProperty("upload");
  });

  it("wires stable live callbacks and invalidates stale references", () => {
    const exec = vi.fn();
    const liveSocket = { js: vi.fn(() => ({ exec })) };
    const initialEvents = {
      onIncrement: [["push", { event: "increment", value: { static: true } }]],
    };
    const hook = createTestHook(
      { "data-events": JSON.stringify(initialEvents) },
      {},
      liveSocket,
    );

    invoke(liveViewReactHook.mounted, hook);
    const first = lastRenderedProps().onIncrement as (
      payload?: Record<string, unknown>,
    ) => void;

    setAttributes(hook, {
      "data-props-diff": "",
      "data-props-kind": "patch",
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);
    const unchanged = lastRenderedProps().onIncrement;
    expect(unchanged).toBe(first);

    setAttributes(hook, {
      "data-events": JSON.stringify({
        onIncrement: [["push", { event: "increment-v2" }]],
      }),
    });
    invoke(liveViewReactHook.updated, hook);
    const changed = lastRenderedProps().onIncrement as () => void;
    expect(changed).not.toBe(first);

    first({ client: true });
    expect(exec).not.toHaveBeenCalled();
    changed();
    expect(exec).toHaveBeenCalledTimes(1);

    setAttributes(hook, { "data-events": "{}" });
    invoke(liveViewReactHook.updated, hook);
    expect(lastRenderedProps()).not.toHaveProperty("onIncrement");
    changed();
    expect(exec).toHaveBeenCalledTimes(1);

    setAttributes(hook, { "data-events": JSON.stringify(initialEvents) });
    invoke(liveViewReactHook.updated, hook);
    const beforeDestroy = lastRenderedProps().onIncrement as () => void;
    invoke(liveViewReactHook.destroyed, hook);
    beforeDestroy();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("exposes explicit failure callbacks while hydrating", () => {
    const events = {
      onIncrement: [["push", { event: "increment" }]],
    };
    const hook = createTestHook(
      {
        id: "hydration-events",
        "data-events": JSON.stringify(events),
      },
      {
        "data-react-hydration": hydrationDescriptor(
          "hydration-events",
          {},
          {},
          "TestComponent",
          events,
        ),
      },
      { js: () => ({ exec: vi.fn() }) },
    );

    invoke(liveViewReactHook.mounted, hook);

    const serverProps = findComponentProps(
      vi.mocked(ReactDOM.hydrateRoot).mock.calls[0]?.[1] as ReactNode,
    );
    expect(() => (serverProps?.onIncrement as () => void)()).toThrow(
      "unavailable during server rendering or hydration",
    );
  });

  it("decodes the default slot into a React child", () => {
    const hook = createTestHook({
      "data-slots": JSON.stringify({
        default: btoa("<strong>slot content</strong>"),
      }),
    });

    invoke(liveViewReactHook.mounted, hook);

    const child = lastRenderedProps().children;
    expect(isValidElement(child) && child.props).toMatchObject({
      dangerouslySetInnerHTML: { __html: "<strong>slot content</strong>" },
    });
  });

  it("applies props patches without replacing untouched props", () => {
    const hook = createTestHook({
      "data-props": encodeProps({ retained: true, title: "Initial" }),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/title", "Patched"]]),
      "data-props-kind": "patch",
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps()).toMatchObject({
      retained: true,
      title: "Patched",
    });
  });

  it("replaces props wholesale for a props snapshot", () => {
    const hook = createTestHook({
      "data-props": encodeProps({ removed: true, title: "Initial" }),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props": encodeProps({ title: "Snapshot" }),
      "data-props-kind": "snapshot",
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().title).toBe("Snapshot");
    expect(lastRenderedProps()).not.toHaveProperty("removed");
  });

  it("terminates after a partially invalid update", () => {
    const hook = createTestHook({
      "data-props": encodeProps({ nested: { count: 1 }, retained: true }),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/nested/count", 2]]),
      "data-props-kind": "patch",
      "data-streams-kind": "invalid",
    });
    expect(() => invoke(liveViewReactHook.updated, hook)).toThrow(
      "data-streams-kind must be either",
    );

    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(lastRenderedProps()).toMatchObject({
      nested: { count: 1 },
      retained: true,
    });

    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/retained", false]]),
      "data-props-kind": "patch",
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(lastRenderedProps()).toMatchObject({
      nested: { count: 1 },
      retained: true,
    });

    invoke(liveViewReactHook.destroyed, hook);
    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
  });

  it("recovers a malformed patch through one authoritative LiveView rejoin snapshot", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn((callback?: () => void) => callback?.());
    const liveSocket = { connect, disconnect };
    const hook = createTestHook(
      {
        "data-props": encodeProps({ nested: { count: 1 }, retained: true }),
      },
      {},
      liveSocket,
    );
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": "r99:/nested/countn1:2",
      "data-props-kind": "patch",
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    expect(() => invoke(liveViewReactHook.updated, hook)).not.toThrow();
    await Promise.resolve();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(rootMock.unmount).not.toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalledTimes(1);

    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/retained", false]]),
      "data-props-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);
    expect(renderMock).toHaveBeenCalledTimes(1);

    setAttributes(hook, {
      "data-props": encodeProps({ nested: { count: 9 }, recovered: true }),
      "data-props-diff": "",
      "data-props-kind": "snapshot",
      "data-streams-diff": "",
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);
    invoke(liveViewReactHook.reconnected, hook);

    expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledTimes(1);
    expect(rootMock.unmount).not.toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(lastRenderedProps()).toMatchObject({
      nested: { count: 9 },
      recovered: true,
    });
    expect(lastRenderedProps()).not.toHaveProperty("retained");
  });

  it("fails closed on an unsupported transport version", () => {
    const hook = createTestHook();
    invoke(liveViewReactHook.mounted, hook);
    setAttributes(hook, { "data-liveview-react-version": "2" });

    expect(() => invoke(liveViewReactHook.updated, hook)).toThrow(
      'data-liveview-react-version must be "1"',
    );
    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
  });

  it("accumulates stream patches", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        ["add", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": "",
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        ["upsert", "/users/-", { __dom_id: "u2" }],
      ]),
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("resets stale streams on snapshot and does not replay updates on reconnect", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        ["add", "/notifications", []],
        ["upsert", "/notifications/-", { __dom_id: "n1" }],
        ["add", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);
    invoke(liveViewReactHook.disconnected, hook);

    setAttributes(hook, {
      "data-props": encodeProps({ phase: "snapshot" }),
      "data-props-kind": "snapshot",
      "data-streams-diff": encodePatch([
        ["add", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u2" }],
      ]),
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);

    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/phase", "patch"]]),
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        ["add", "/users/-", { __dom_id: "u3" }],
      ]),
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);
    const rendersBeforeReconnect = renderMock.mock.calls.length;

    setAttributes(hook, {
      "data-props-kind": null,
      "data-streams-kind": null,
    });
    invoke(liveViewReactHook.reconnected, hook);

    expect(renderMock).toHaveBeenCalledTimes(rendersBeforeReconnect);
    expect(lastRenderedProps()).toMatchObject({
      phase: "patch",
      users: [{ __dom_id: "u2" }, { __dom_id: "u3" }],
    });
    expect(lastRenderedProps()).not.toHaveProperty("notifications");
  });

  it.each([
    ["missing props kind", "data-props-kind", null],
    ["malformed props kind", "data-props-kind", "delta"],
    ["initial props patch", "data-props-kind", "patch"],
    ["missing streams kind", "data-streams-kind", null],
    ["malformed streams kind", "data-streams-kind", "delta"],
    ["initial streams patch", "data-streams-kind", "patch"],
  ])("rejects %s on mount", (_label, attribute, value) => {
    const hook = createTestHook();
    setAttributes(hook, { [attribute]: value });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow();
  });

  it("rejects a root with an empty id", () => {
    const hook = createTestHook({ id: "" });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "requires a non-empty element id",
    );
  });

  it.each(["updated", "reconnected"] as const)(
    "rejects a component identity change during %s",
    (phase) => {
      const hook = createTestHook();
      invoke(liveViewReactHook.mounted, hook);
      hook.el.setAttribute("data-component", "AnotherComponent");

      expect(() => invoke(liveViewReactHook[phase], hook)).toThrow(
        "data-component cannot change",
      );
    },
  );

  it.each(["updated", "reconnected"] as const)(
    "rejects an element id change during %s",
    (phase) => {
      const hook = createTestHook({ id: "stable-id" });
      invoke(liveViewReactHook.mounted, hook);
      hook.el.id = "changed-id";

      expect(() => invoke(liveViewReactHook[phase], hook)).toThrow(
        "LiveView root id cannot change",
      );
    },
  );

  it("renders the latest snapshot when a lazy component resolves", async () => {
    let resolveComponent!: (module: { default: typeof TestComponent }) => void;
    const componentPromise = new Promise<{ default: typeof TestComponent }>(
      (resolve) => {
        resolveComponent = resolve;
      },
    );
    const lazyRuntime = createLiveViewReact({
      components: {
        LazyComponent: { load: () => componentPromise },
      },
    });
    const hook = createMockLiveViewHook({
      "data-component": "LazyComponent",
      "data-props": encodeProps({ title: "Initial" }),
    });

    invoke(lazyRuntime.hooks.LiveViewReactHook.mounted, hook);
    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/title", "Latest"]]),
      "data-props-kind": "patch",
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    invoke(lazyRuntime.hooks.LiveViewReactHook.updated, hook);
    resolveComponent({ default: TestComponent });

    await vi.waitFor(() => {
      expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledTimes(1);
    });
    expect(lastRenderedProps().title).toBe("Latest");
  });

  it("cancels lazy mounting when destroyed before resolution", async () => {
    let resolveComponent!: (module: { default: typeof TestComponent }) => void;
    const componentPromise = new Promise<{ default: typeof TestComponent }>(
      (resolve) => {
        resolveComponent = resolve;
      },
    );
    const lazyRuntime = createLiveViewReact({
      components: {
        LazyComponent: { load: () => componentPromise },
      },
    });
    const hook = createMockLiveViewHook({
      "data-component": "LazyComponent",
    });

    invoke(lazyRuntime.hooks.LiveViewReactHook.mounted, hook);
    invoke(lazyRuntime.hooks.LiveViewReactHook.destroyed, hook);
    resolveComponent({ default: TestComponent });
    await componentPromise;
    await Promise.resolve();

    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalled();
    expect(vi.mocked(ReactDOM.hydrateRoot)).not.toHaveBeenCalled();
    expect(rootMock.unmount).not.toHaveBeenCalled();
  });

  it("cancels a pending lazy mount after an identity violation", async () => {
    let resolveComponent!: (module: { default: typeof TestComponent }) => void;
    const componentPromise = new Promise<{ default: typeof TestComponent }>(
      (resolve) => {
        resolveComponent = resolve;
      },
    );
    const lazyRuntime = createLiveViewReact({
      components: {
        LazyComponent: { load: () => componentPromise },
      },
    });
    const hook = createMockLiveViewHook({
      "data-component": "LazyComponent",
    });

    invoke(lazyRuntime.hooks.LiveViewReactHook.mounted, hook);
    hook.el.setAttribute("data-component", "AnotherComponent");
    expect(() =>
      invoke(lazyRuntime.hooks.LiveViewReactHook.updated, hook),
    ).toThrow("data-component cannot change");

    resolveComponent({ default: TestComponent });
    await componentPromise;
    await Promise.resolve();

    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalled();
    expect(vi.mocked(ReactDOM.hydrateRoot)).not.toHaveBeenCalled();
  });

  it("owns independent roots for independent hook instances", () => {
    const renderA = vi.fn();
    const renderB = vi.fn();
    const rootA = { render: renderA, unmount: vi.fn() };
    const rootB = { render: renderB, unmount: vi.fn() };
    vi.mocked(ReactDOM.createRoot)
      .mockImplementationOnce(() => rootA)
      .mockImplementationOnce(() => rootB);
    const hookA = createTestHook({ id: "root-a" });
    const hookB = createTestHook({ id: "root-b" });

    invoke(liveViewReactHook.mounted, hookA);
    invoke(liveViewReactHook.mounted, hookB);

    expect(vi.mocked(ReactDOM.createRoot).mock.calls[0]?.[0]).toBe(
      hookA.target,
    );
    expect(vi.mocked(ReactDOM.createRoot).mock.calls[1]?.[0]).toBe(
      hookB.target,
    );
    expect(renderA).toHaveBeenCalledTimes(1);
    expect(renderB).toHaveBeenCalledTimes(1);

    invoke(liveViewReactHook.destroyed, hookA);
    expect(rootA.unmount).toHaveBeenCalledTimes(1);
    expect(rootB.unmount).not.toHaveBeenCalled();
  });

  it("forwards React root callbacks and omits undefined options", () => {
    const onCaughtError = vi.fn();
    const onRecoverableError = vi.fn();
    const onUncaughtError = vi.fn();
    const configuredRuntime = createLiveViewReact({
      components: { TestComponent: { component: TestComponent } },
      onCaughtError,
      onRecoverableError,
      onUncaughtError,
    });
    const clientHook = createTestHook({ id: "client-root" });
    const hydratedHook = createTestHook(
      { id: "hydrated-root" },
      { "data-react-hydration": hydrationDescriptor("hydrated-root") },
    );

    invoke(configuredRuntime.hooks.LiveViewReactHook.mounted, clientHook);
    invoke(configuredRuntime.hooks.LiveViewReactHook.mounted, hydratedHook);

    const expectedOptions = {
      identifierPrefix: createIdentifierPrefix("client-root"),
      onCaughtError,
      onRecoverableError,
      onUncaughtError,
    };
    expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledWith(
      clientHook.target,
      expectedOptions,
    );
    expect(vi.mocked(ReactDOM.hydrateRoot).mock.calls[0]?.[2]).toEqual({
      ...expectedOptions,
      identifierPrefix: createIdentifierPrefix("hydrated-root"),
    });

    const defaultHook = createTestHook({ id: "default-root" });
    const defaultHydratedHook = createTestHook(
      { id: "default-hydrated-root" },
      {
        "data-react-hydration": hydrationDescriptor("default-hydrated-root"),
      },
    );
    invoke(liveViewReactHook.mounted, defaultHook);
    invoke(liveViewReactHook.mounted, defaultHydratedHook);
    const defaultOptions = vi
      .mocked(ReactDOM.createRoot)
      .mock.calls.at(-1)?.[1];
    const defaultHydrationOptions = vi
      .mocked(ReactDOM.hydrateRoot)
      .mock.calls.at(-1)?.[2];
    expect(defaultOptions).toEqual({
      identifierPrefix: createIdentifierPrefix("default-root"),
    });
    expect(defaultHydrationOptions).toEqual({
      identifierPrefix: createIdentifierPrefix("default-hydrated-root"),
    });
    expect(defaultOptions).not.toHaveProperty("onCaughtError");
    expect(defaultOptions).not.toHaveProperty("onRecoverableError");
    expect(defaultOptions).not.toHaveProperty("onUncaughtError");
    expect(defaultHydrationOptions).not.toHaveProperty("onCaughtError");
    expect(defaultHydrationOptions).not.toHaveProperty("onRecoverableError");
    expect(defaultHydrationOptions).not.toHaveProperty("onUncaughtError");
  });

  it("applies StrictMode and a custom wrapper around the component", () => {
    const wrapRoot = vi.fn(
      ({
        children,
        componentName,
      }: import("./types").LiveViewReactRootWrapperContext) =>
        createElement(
          "section",
          { "data-wrapped-component": componentName },
          children,
        ),
    );
    const configuredRuntime = createLiveViewReact({
      components: { TestComponent: { component: TestComponent } },
      strictMode: true,
      wrapRoot,
    });
    const hook = createTestHook();

    invoke(configuredRuntime.hooks.LiveViewReactHook.mounted, hook);

    const tree = renderMock.mock.calls.at(-1)?.[0] as ReactNode;
    expect(isValidElement(tree) && tree.type).toBe(StrictMode);
    expect(
      findElement(tree, (element) => element.type === "section")?.props,
    ).toMatchObject({ "data-wrapped-component": "TestComponent" });
    expect(wrapRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        componentName: "TestComponent",
        element: hook.el,
      }),
    );
  });

  it("fails fast when data-component is missing", () => {
    const hook = createMockLiveViewHook();

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "data-component must name a registered component",
    );
  });

  it("fails fast when the component is not registered", () => {
    const hook = createMockLiveViewHook({ "data-component": "Missing" });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      'Component "Missing" is not registered',
    );
  });

  it("mounts a tagged lazy component", async () => {
    const lazyRuntime = createLiveViewReact({
      components: {
        LazyComponent: {
          load: async () => ({ default: TestComponent }),
        },
      },
    });
    const hook = createMockLiveViewHook({
      "data-component": "LazyComponent",
      "data-props": encodeProps({ title: "Lazy" }),
    });

    invoke(lazyRuntime.hooks.LiveViewReactHook.mounted, hook);

    await vi.waitFor(() => {
      expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledTimes(1);
    });
    expect(lastRenderedProps().title).toBe("Lazy");
  });

  it("rejects untagged registry values", () => {
    expect(() =>
      createLiveViewReact({
        components: { TestComponent } as never,
      }),
    ).toThrow("must use a tagged { component } or { load } registry entry");
  });

  it("rejects invalid tagged component values", () => {
    expect(() =>
      createLiveViewReact({
        components: { Invalid: { component: {} } } as never,
      }),
    ).toThrow('Component "Invalid" has an invalid component value');
  });
});
