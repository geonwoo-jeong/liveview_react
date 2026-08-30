import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHook,
  encodePatch,
  encodeProps,
  expectLifecycleFailure,
  invoke,
  lastRenderedProps,
  renderMock,
  rootMock,
  setAttributes,
  streamFrame,
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
    expectLifecycleFailure(
      () => invoke(liveViewReactHook.updated, hook),
      "data-streams-kind must be",
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

  it("recovers a malformed stream frame without partially advancing state", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn((callback?: () => void) => callback?.());
    const hook = createTestHook(
      {
        "data-props": encodeProps({ phase: "initial" }),
        "data-streams-diff": encodePatch([
          ["stream", "/users", streamFrame([{ __dom_id: "u1" }])],
        ]),
      },
      {},
      { connect, disconnect },
    );
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": encodePatch([
        ["replace", "/phase", "must-not-commit"],
      ]),
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        ["stream", "/users", { items: [], inserts: [], deletes: [] }],
      ]),
      "data-streams-kind": "patch",
    });
    expect(() => invoke(liveViewReactHook.updated, hook)).not.toThrow();
    await Promise.resolve();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(rootMock.unmount).not.toHaveBeenCalled();
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(lastRenderedProps()).toMatchObject({
      phase: "initial",
      users: [{ __dom_id: "u1" }],
    });

    setAttributes(hook, {
      "data-props": encodeProps({ phase: "recovered" }),
      "data-props-diff": "",
      "data-props-kind": "snapshot",
      "data-streams-diff": encodePatch([
        ["stream", "/users", streamFrame([{ __dom_id: "u2" }])],
      ]),
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);
    invoke(liveViewReactHook.reconnected, hook);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(lastRenderedProps()).toMatchObject({
      phase: "recovered",
      users: [{ __dom_id: "u2" }],
    });
  });

  it("fails closed on an unsupported transport version", () => {
    const hook = createTestHook();
    invoke(liveViewReactHook.mounted, hook);
    setAttributes(hook, { "data-liveview-react-version": "1" });

    expectLifecycleFailure(
      () => invoke(liveViewReactHook.updated, hook),
      'data-liveview-react-version must be "2"',
    );
    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
  });

  it("accumulates stream patches", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        ["stream", "/users", streamFrame([{ __dom_id: "u1" }])],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": "",
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        ["stream", "/users", streamFrame([{ __dom_id: "u2" }])],
      ]),
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().users).toEqual([
      { __dom_id: "u1" },
      { __dom_id: "u2" },
    ]);
  });

  it("starts a non-hydration stream snapshot without prior membership", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame([{ __dom_id: "u1", name: "Update only" }], {
            inserts: [["u1", -1, null, true]],
          }),
        ],
      ]),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(lastRenderedProps().users).toEqual([]);
  });

  it("keeps untouched stream and item references while freezing changed data", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/notifications",
          streamFrame([{ __dom_id: "n1", message: "stable" }]),
        ],
        [
          "stream",
          "/users",
          streamFrame([
            { __dom_id: "u1", name: "before" },
            { __dom_id: "u2", name: "stable" },
          ]),
        ],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);
    const firstProps = lastRenderedProps();
    const users = firstProps.users as readonly Readonly<{
      readonly __dom_id: string;
    }>[];
    const notifications = firstProps.notifications as readonly Readonly<{
      readonly __dom_id: string;
    }>[];

    setAttributes(hook, {
      "data-props-diff": "",
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame([{ __dom_id: "u1", name: "after" }], {
            inserts: [["u1", 0, null, false]],
          }),
        ],
      ]),
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);

    const nextProps = lastRenderedProps();
    const nextUsers = nextProps.users as typeof users;
    expect(nextUsers).not.toBe(users);
    expect(nextUsers[0]).not.toBe(users[0]);
    expect(nextUsers[1]).toBe(users[1]);
    expect(nextProps.notifications).toBe(notifications);
    expect(Object.isFrozen(nextUsers)).toBe(true);
    expect(Object.isFrozen(nextUsers[0])).toBe(true);
  });

  it("uses the prior stream membership for update-only connected snapshots", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame([
            { __dom_id: "u1", name: "Ada" },
            { __dom_id: "u2", name: "Grace" },
          ]),
        ],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props": encodeProps({ phase: "connected" }),
      "data-props-kind": "snapshot",
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame(
            [
              { __dom_id: "u1", name: "Ada connected" },
              { __dom_id: "u3", name: "Missing on client" },
            ],
            {
              inserts: [
                ["u1", 0, 1, true],
                ["u3", -1, null, true],
              ],
            },
          ),
        ],
      ]),
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps()).toMatchObject({
      phase: "connected",
      users: [{ __dom_id: "u1", name: "Ada connected" }],
    });
  });

  it("applies incremental deletes and stream-local resets", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame([{ __dom_id: "u1" }, { __dom_id: "u2" }]),
        ],
        ["stream", "/notifications", streamFrame([{ __dom_id: "n1" }])],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);

    setAttributes(hook, {
      "data-props-diff": "",
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        ["stream", "/users", streamFrame([], { deletes: ["u1", "missing"] })],
      ]),
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);
    expect(lastRenderedProps()).toMatchObject({
      notifications: [{ __dom_id: "n1" }],
      users: [{ __dom_id: "u2" }],
    });

    setAttributes(hook, {
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame([{ __dom_id: "u3" }], { reset: true }),
        ],
      ]),
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps()).toMatchObject({
      notifications: [{ __dom_id: "n1" }],
      users: [{ __dom_id: "u3" }],
    });
  });

  it.each([
    [
      "a missing DOM id",
      encodePatch([
        [
          "stream",
          "/users",
          {
            items: [{ name: "Ada" }],
            inserts: [["u1", -1, null, false]],
            deletes: [],
            reset: false,
          },
        ],
      ]),
      "__dom_id",
    ],
    [
      "a duplicate DOM id",
      encodePatch([
        [
          "stream",
          "/users",
          streamFrame([{ __dom_id: "u1" }, { __dom_id: "u1" }]),
        ],
      ]),
      "duplicate __dom_id",
    ],
    [
      "a missing frame field",
      encodePatch([
        ["stream", "/users", { items: [], inserts: [], deletes: [] }],
      ]),
      "requires field",
    ],
    [
      "a prototype-sensitive path",
      encodePatch([["stream", "/__proto__", streamFrame([])]]),
      "prototype-sensitive key",
    ],
  ])(
    "fails closed on initial stream data with %s",
    (_label, payload, message) => {
      const hook = createTestHook({ "data-streams-diff": payload });

      expectLifecycleFailure(
        () => invoke(liveViewReactHook.mounted, hook),
        message,
      );
      expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalled();
    },
  );

  it("resets stale streams on snapshot and does not replay updates on reconnect", () => {
    const hook = createTestHook({
      "data-streams-diff": encodePatch([
        ["stream", "/notifications", streamFrame([{ __dom_id: "n1" }])],
        ["stream", "/users", streamFrame([{ __dom_id: "u1" }])],
      ]),
    });
    invoke(liveViewReactHook.mounted, hook);
    invoke(liveViewReactHook.disconnected, hook);

    setAttributes(hook, {
      "data-props": encodeProps({ phase: "snapshot" }),
      "data-props-kind": "snapshot",
      "data-streams-diff": encodePatch([
        ["stream", "/users", streamFrame([{ __dom_id: "u2" }])],
      ]),
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);

    setAttributes(hook, {
      "data-props-diff": encodePatch([["replace", "/phase", "patch"]]),
      "data-props-kind": "patch",
      "data-streams-diff": encodePatch([
        ["stream", "/users", streamFrame([{ __dom_id: "u3" }])],
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
    ["orphan hydration streams", "data-streams-kind", "hydration"],
  ])("rejects %s on mount", (_label, attribute, value) => {
    const hook = createTestHook();
    setAttributes(hook, { [attribute]: value });

    expectLifecycleFailure(() => invoke(liveViewReactHook.mounted, hook));
  });
});
