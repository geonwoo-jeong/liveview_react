import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHook,
  encodePatch,
  encodeProps,
  invoke,
  lastRenderedProps,
  renderMock,
  rootMock,
  setAttributes,
  TestComponent,
} from "./hooks.test-support";

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => rootMock),
  hydrateRoot: vi.fn(() => rootMock),
}));

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
    ["missing slots", "data-slots", null],
    ["malformed slots", "data-slots", "{"],
    ["missing streams kind", "data-streams-kind", null],
    ["malformed streams kind", "data-streams-kind", "delta"],
    ["initial streams patch", "data-streams-kind", "patch"],
  ])("rejects %s on mount", (_label, attribute, value) => {
    const hook = createTestHook();
    setAttributes(hook, { [attribute]: value });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow();
  });
});
