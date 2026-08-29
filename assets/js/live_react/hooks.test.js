import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockLiveViewHook } from "./tests/helpers";

const renderMock = vi.fn();
const rootMock = { render: renderMock, unmount: vi.fn() };

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: vi.fn(() => rootMock),
    hydrateRoot: vi.fn(() => rootMock),
  },
}));

const TestComponent = () => null;

function findComponentProps(element) {
  if (!element || typeof element !== "object") return null;
  if (element.type === TestComponent) return element.props;

  const children = element.props?.children;

  if (Array.isArray(children)) {
    for (const child of children) {
      const props = findComponentProps(child);
      if (props) return props;
    }

    return null;
  }

  return findComponentProps(children);
}

function lastRenderedProps() {
  return findComponentProps(renderMock.mock.calls.at(-1)[0]);
}

// Minimal test-only encoder mirroring LiveReact.Patch.serialize/1 and
// LiveReact.Patch.encode_object/1, so fixtures can't drift from hand-typed
// wire strings. Exercised indirectly by decodeCompactPatch/decodeCompactJson
// (already unit-tested against real Elixir-produced fixtures in Task 9).
const OP_CODES = {
  add: "a",
  remove: "d",
  replace: "r",
  upsert: "u",
  limit: "l",
};

function encodeValue(value) {
  if (value === null) return "z";
  if (value === true) return "b1";
  if (value === false) return "b0";
  if (typeof value === "number") {
    const s = String(value);
    return `n${s.length}:${s}`;
  }
  if (typeof value === "string") return `s${value.length}:${value}`;
  const json = JSON.stringify(value).replace(/"/g, "^");
  return `J${json.length}:${json}`;
}

function encodePatch(ops) {
  return ops
    .map(([op, path, value]) => {
      const prefix = `${OP_CODES[op]}${path.length}:${path}`;
      return op === "remove" ? prefix : prefix + encodeValue(value);
    })
    .join("");
}

function encodeProps(props) {
  return JSON.stringify(props).replace(/"/g, "^");
}

describe("current hook lifecycle characterization", () => {
  let getHooks;
  let ReactHook;
  let ReactDOM;

  beforeEach(async () => {
    vi.resetModules();
    ReactDOM = (await import("react-dom/client")).default;
    ({ getHooks } = await import("./hooks"));
    ({ ReactHook } = getHooks({ TestComponent }));
    vi.clearAllMocks();
  });

  it("creates one root and reuses it across updates and reconnects", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Initial" }),
      "data-use-diff": "false",
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-use-diff") return "false";
      if (name === "data-props") return encodeProps({ title: "Updated" });
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.updated.call(hook);
    ReactHook.reconnected.call(hook);

    expect(ReactDOM.createRoot).toHaveBeenCalledTimes(1);
    expect(ReactDOM.hydrateRoot).not.toHaveBeenCalled();
    expect(hook._root).toBe(rootMock);
    expect(renderMock).toHaveBeenCalledTimes(3);
  });

  it("hydrates existing server-rendered markup instead of creating a root", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Server rendered" }),
      "data-ssr": "true",
    });

    ReactHook.mounted.call(hook);

    expect(ReactDOM.hydrateRoot).toHaveBeenCalledTimes(1);
    expect(ReactDOM.createRoot).not.toHaveBeenCalled();
    expect(hook._root).toBe(rootMock);
  });

  it("preserves false, zero, null, and empty-string props", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({
        enabled: false,
        count: 0,
        selection: null,
        label: "",
      }),
    });

    ReactHook.mounted.call(hook);

    expect(lastRenderedProps()).toMatchObject({
      enabled: false,
      count: 0,
      selection: null,
      label: "",
    });
  });

  it("merges base props and streams on mount", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    ReactHook.mounted.call(hook);

    const props = lastRenderedProps();
    expect(props.title).toBe("Hello");
    expect(props.users).toEqual([{ __dom_id: "u1" }]);
  });

  it("applies props_diff on update when data-use-diff is true", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-use-diff": "true",
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props-diff")
        return encodePatch([["replace", "/title", "World"]]);
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.updated.call(hook);

    expect(lastRenderedProps().title).toBe("World");
  });

  it("replaces props wholesale on update when data-use-diff is false", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-use-diff": "false",
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-use-diff") return "false";
      if (name === "data-props") return encodeProps({ title: "Replaced" });
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.updated.call(hook);

    expect(lastRenderedProps().title).toBe("Replaced");
  });

  it("accumulates stream inserts across updates without losing prior items", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({}),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props-diff") return null;
      if (name === "data-streams-diff")
        return encodePatch([["upsert", "/users/-", { __dom_id: "u2" }]]);
      return null;
    });

    ReactHook.updated.call(hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("reconnected() resyncs streams via diff, same as updated()", () => {
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
      "data-streams-diff": encodePatch([
        ["replace", "/users", []],
        ["upsert", "/users/-", { __dom_id: "u1" }],
      ]),
    });

    ReactHook.mounted.call(hook);

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-use-diff") return "true";
      if (name === "data-props") return encodeProps({ title: "Hello" });
      if (name === "data-props-diff") return null;
      if (name === "data-streams-diff")
        return encodePatch([["upsert", "/users/-", { __dom_id: "u2" }]]);
      return null;
    });

    ReactHook.reconnected.call(hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("reconnected() does a full props resync from data-props instead of applying a diff", () => {
    // Regression test: on a real LiveView reconnect the server process is
    // fresh (assigns.__changed__ == nil), so calculate_props_diff/2 produces
    // an EMPTY diff regardless of how much server state actually changed
    // while disconnected. The full, current snapshot is sent via data-props
    // instead. reconnected() must read that fresh snapshot rather than
    // applying the (necessarily empty) data-props-diff to the stale
    // in-memory props, or the component would keep showing stale data after
    // reconnecting.
    const hook = createMockLiveViewHook({
      "data-name": "TestComponent",
      "data-props": encodeProps({ title: "Hello" }),
    });

    ReactHook.mounted.call(hook);
    expect(lastRenderedProps().title).toBe("Hello");

    hook.el.getAttribute.mockImplementation((name) => {
      if (name === "data-use-diff") return "true";
      // Fresh full snapshot reflecting server state that advanced while
      // disconnected...
      if (name === "data-props") return encodeProps({ title: "World" });
      // ...paired with the empty diff the server actually sends on
      // reconnect (init = true means calculate_props_diff/2 has nothing to
      // report).
      if (name === "data-props-diff") return encodePatch([]);
      if (name === "data-streams-diff") return null;
      return null;
    });

    ReactHook.reconnected.call(hook);

    expect(lastRenderedProps().title).toBe("World");
  });
});
