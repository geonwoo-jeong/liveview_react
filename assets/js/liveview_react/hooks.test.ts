import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLiveViewHook } from "./tests/helpers";

const renderMock = vi.fn();
const rootMock = { render: renderMock, unmount: vi.fn() };

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => rootMock),
  hydrateRoot: vi.fn(() => rootMock),
}));

const TestComponent = (_props: Record<string, unknown>) => null;

function findComponentProps(
  element: ReactNode,
): Record<string, unknown> | null {
  if (!isValidElement<Record<string, unknown>>(element)) return null;
  if (element.type === TestComponent) return element.props;

  const children = element.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const props = findComponentProps(child as ReactNode);
      if (props) return props;
    }

    return null;
  }

  return findComponentProps(children as ReactNode);
}

function lastRenderedProps(): Record<string, unknown> {
  const lastRender = renderMock.mock.calls.at(-1);
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
  const json = JSON.stringify(value).replace(/"/g, "^");
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
  return JSON.stringify(props).replace(/"/g, "^");
}

function invoke(callback: Function, hook: object): void {
  Reflect.apply(callback, hook, []);
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
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Initial" }),
      "data-use-diff": "false",
    });

    invoke(liveViewReactHook.mounted, hook);

    hook.el.getAttribute.mockImplementation((name: string) => {
      if (name === "data-use-diff") return "false";
      if (name === "data-props") return encodeProps({ title: "Updated" });
      if (name === "data-streams-diff") return null;
      return null;
    });

    invoke(liveViewReactHook.updated, hook);
    invoke(liveViewReactHook.reconnected, hook);

    expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ReactDOM.hydrateRoot)).not.toHaveBeenCalled();
    expect((hook as unknown as Record<string, unknown>)._root).toBe(rootMock);
    expect(renderMock).toHaveBeenCalledTimes(3);
  });

  it("mounts inside the dedicated React-owned target", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({}),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(vi.mocked(ReactDOM.createRoot)).toHaveBeenCalledWith(hook.target);
    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalledWith(hook.el);
  });

  it("unmounts the root immediately and exactly once when destroyed", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({}),
    });

    invoke(liveViewReactHook.mounted, hook);
    invoke(liveViewReactHook.destroyed, hook);
    invoke(liveViewReactHook.destroyed, hook);

    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
  });

  it("hydrates existing server-rendered markup instead of creating a root", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Server rendered" }),
      "data-ssr": "true",
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(vi.mocked(ReactDOM.hydrateRoot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalled();
    expect((hook as unknown as Record<string, unknown>)._root).toBe(rootMock);
  });

  it("preserves false, zero, null, and empty-string props", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({
        enabled: false,
        count: 0,
        selection: null,
        label: "",
      }),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(lastRenderedProps()).toMatchObject({
      enabled: false,
      count: 0,
      selection: null,
      label: "",
    });
  });

  it("passes only server props to the component", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(lastRenderedProps()).toMatchObject({ title: "Hello" });
    expect(lastRenderedProps()).not.toHaveProperty("pushEvent");
    expect(lastRenderedProps()).not.toHaveProperty("upload");
  });

  it("merges base props and streams on mount", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    invoke(liveViewReactHook.mounted, hook);

    const props = lastRenderedProps();
    expect(props.title).toBe("Hello");
    expect(props.users).toEqual([{ __dom_id: "u1" }]);
  });

  it("applies props diff on update when data-use-diff is true", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-use-diff": "true",
    });

    invoke(liveViewReactHook.mounted, hook);

    hook.el.getAttribute.mockImplementation((name: string) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props-diff") {
        return encodePatch([["replace", "/title", "World"]]);
      }
      if (name === "data-streams-diff") return null;
      return null;
    });

    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().title).toBe("World");
  });

  it("replaces props wholesale when data-use-diff is false", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-use-diff": "false",
    });

    invoke(liveViewReactHook.mounted, hook);

    hook.el.getAttribute.mockImplementation((name: string) => {
      if (name === "data-use-diff") return "false";
      if (name === "data-props") return encodeProps({ title: "Replaced" });
      if (name === "data-streams-diff") return null;
      return null;
    });

    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().title).toBe("Replaced");
  });

  it("accumulates stream inserts across updates", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({}),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    invoke(liveViewReactHook.mounted, hook);

    hook.el.getAttribute.mockImplementation((name: string) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props-diff") return null;
      if (name === "data-streams-diff") {
        return encodePatch([["upsert", "/users/-", { __dom_id: "u2" }]]);
      }
      return null;
    });

    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("resyncs streams on reconnect", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    invoke(liveViewReactHook.mounted, hook);

    hook.el.getAttribute.mockImplementation((name: string) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props") return encodeProps({ title: "Hello" });
      if (name === "data-props-diff") return null;
      if (name === "data-streams-diff") {
        return encodePatch([["upsert", "/users/-", { __dom_id: "u2" }]]);
      }
      return null;
    });

    invoke(liveViewReactHook.reconnected, hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("does a full props resync on reconnect", () => {
    const hook = createMockLiveViewHook({
      "data-component": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
    });

    invoke(liveViewReactHook.mounted, hook);
    expect(lastRenderedProps().title).toBe("Hello");

    hook.el.getAttribute.mockImplementation((name: string) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props") return encodeProps({ title: "World" });
      if (name === "data-props-diff") return encodePatch([]);
      if (name === "data-streams-diff") return null;
      return null;
    });

    invoke(liveViewReactHook.reconnected, hook);

    expect(lastRenderedProps().title).toBe("World");
  });

  it("fails fast when data-component is missing", () => {
    const hook = createMockLiveViewHook({ "data-props": encodeProps({}) });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "data-component must name a registered component",
    );
  });

  it("fails fast when the component is not registered", () => {
    const hook = createMockLiveViewHook({
      "data-component": "Missing",
      "data-props": encodeProps({}),
    });

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

  it("rejects untagged component registry values", () => {
    expect(() =>
      createLiveViewReact({
        components: { TestComponent } as never,
      }),
    ).toThrow("must use a tagged { component } or { load } registry entry");
  });

  it("rejects arbitrary objects in tagged component entries", () => {
    expect(() =>
      createLiveViewReact({
        components: { Invalid: { component: {} } } as never,
      }),
    ).toThrow('Component "Invalid" has an invalid component value');
  });
});
