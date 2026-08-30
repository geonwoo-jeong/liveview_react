import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHook,
  encodeBase64Utf8,
  encodePatch,
  encodeProps,
  findComponentProps,
  hydrationDescriptor,
  invoke,
  lastRenderedProps,
  reactElementProps,
  rootMock,
  setAttributes,
  streamFrame,
  TestComponent,
} from "./hooks.test-support";
import { createIdentifierPrefix } from "./runtime/identifier-prefix";

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
        version: 1,
        component: "TestComponent",
        events: {},
        identifierPrefix: createIdentifierPrefix("malformed-root"),
        props: {},
        slots: {},
        streams: {},
      }),
    ],
    [
      "component mismatch",
      hydrationDescriptor("malformed-root", {}, {}, "AnotherComponent"),
    ],
    [
      "missing identifier prefix",
      JSON.stringify({
        version: 2,
        component: "TestComponent",
        events: {},
        props: {},
        slots: {},
        streams: {},
      }),
    ],
    ["identifier prefix mismatch", hydrationDescriptor("another-root")],
    [
      "non-object props",
      JSON.stringify({
        version: 2,
        component: "TestComponent",
        events: {},
        identifierPrefix: createIdentifierPrefix("malformed-root"),
        props: [],
        slots: {},
        streams: {},
      }),
    ],
    [
      "invalid slots",
      JSON.stringify({
        version: 2,
        component: "TestComponent",
        events: {},
        identifierPrefix: createIdentifierPrefix("malformed-root"),
        props: {},
        slots: { default: 1 },
        streams: {},
      }),
    ],
  ])("rejects a malformed hydration descriptor: %s", (_label, descriptor) => {
    const hook = createTestHook(
      { id: "malformed-root" },
      { "data-react-hydration": descriptor },
    );

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow();
  });

  it("hydrates the exact dead stream frame before flushing a newer connected snapshot", () => {
    const hook = createTestHook(
      { id: "hydration-stream-race" },
      {
        "data-react-hydration": hydrationDescriptor(
          "hydration-stream-race",
          { phase: "dead" },
          {},
          "TestComponent",
          {},
          {
            users: [{ __dom_id: "users-1", name: "Dead Ada" }],
          },
        ),
      },
    );

    invoke(liveViewReactHook.mounted, hook);

    const hydrationTree = vi.mocked(ReactDOM.hydrateRoot).mock.calls[0]?.[1];
    const deadProps = findComponentProps(hydrationTree as ReactNode);
    expect(deadProps).toMatchObject({
      phase: "dead",
      users: [{ __dom_id: "users-1", name: "Dead Ada" }],
    });
    expect(Object.isFrozen(deadProps?.users)).toBe(true);
    expect(
      Object.isFrozen(
        (deadProps?.users as readonly unknown[] | undefined)?.[0],
      ),
    ).toBe(true);

    setAttributes(hook, {
      "data-props": encodeProps({ phase: "connected" }),
      "data-props-kind": "snapshot",
      "data-streams-diff": encodePatch([
        [
          "stream",
          "/users",
          streamFrame([{ __dom_id: "users-1", name: "Connected Ada" }], {
            inserts: [["users-1", -1, null, true]],
          }),
        ],
      ]),
      "data-streams-kind": "snapshot",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(rootMock.render).not.toHaveBeenCalled();
    if (!isValidElement<{ readonly onCommit?: () => void }>(hydrationTree)) {
      throw new Error("Expected the hydration commit boundary");
    }
    hydrationTree.props.onCommit?.();

    expect(lastRenderedProps()).toMatchObject({
      phase: "connected",
      users: [{ __dom_id: "users-1", name: "Connected Ada" }],
    });
  });

  it("uses hydration streams as prior membership for the initial connected snapshot", () => {
    const hook = createTestHook(
      {
        id: "hydration-initial-stream-snapshot",
        "data-props": encodeProps({ phase: "connected" }),
        "data-streams-diff": encodePatch([
          [
            "stream",
            "/users",
            streamFrame(
              [
                { __dom_id: "users-1", name: "Connected Ada" },
                { __dom_id: "users-2", name: "Not in dead HTML" },
              ],
              {
                inserts: [
                  ["users-1", -1, null, true],
                  ["users-2", -1, null, true],
                ],
              },
            ),
          ],
        ]),
        "data-streams-kind": "snapshot",
      },
      {
        "data-react-hydration": hydrationDescriptor(
          "hydration-initial-stream-snapshot",
          { phase: "dead" },
          {},
          "TestComponent",
          {},
          { users: [{ __dom_id: "users-1", name: "Dead Ada" }] },
        ),
      },
    );

    invoke(liveViewReactHook.mounted, hook);

    const hydrationTree = vi.mocked(ReactDOM.hydrateRoot).mock.calls[0]?.[1];
    expect(findComponentProps(hydrationTree as ReactNode)).toMatchObject({
      phase: "dead",
      users: [{ __dom_id: "users-1", name: "Dead Ada" }],
    });
    if (!isValidElement<{ readonly onCommit?: () => void }>(hydrationTree)) {
      throw new Error("Expected the hydration commit boundary");
    }
    hydrationTree.props.onCommit?.();

    expect(lastRenderedProps()).toMatchObject({
      phase: "connected",
      users: [{ __dom_id: "users-1", name: "Connected Ada" }],
    });
  });

  it("rejects a duplicate wrapper stream payload in hydration mode", () => {
    const hook = createTestHook(
      {
        id: "duplicate-hydration-streams",
        "data-streams-diff": encodePatch([
          ["stream", "/users", streamFrame([])],
        ]),
      },
      {
        "data-react-hydration": hydrationDescriptor(
          "duplicate-hydration-streams",
          {},
          {},
          "TestComponent",
          {},
          { users: [] },
        ),
      },
    );

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "must omit data-streams-diff payload",
    );
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
    expect(exec).toHaveBeenCalledWith([["push", { event: "increment-v2" }]]);

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

  it("fails clearly when the public Hook js executor is unavailable", () => {
    const hook = createTestHook({
      "data-events": JSON.stringify({
        onIncrement: [["push", { event: "increment" }]],
      }),
    });
    hook.js.mockReturnValue({} as never);

    invoke(liveViewReactHook.mounted, hook);
    const callback = lastRenderedProps().onIncrement as () => void;

    expect(() => callback()).toThrow(
      "React event callbacks require the LiveView Hook public js().exec API",
    );
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
    const onIncrement = serverProps?.onIncrement;
    if (typeof onIncrement !== "function") {
      throw new Error("Expected the hydrated onIncrement callback");
    }
    expect(() => onIncrement()).toThrow(
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
      "data-liveview-react-slot": "default",
      dangerouslySetInnerHTML: { __html: "<strong>slot content</strong>" },
    });
  });

  it("decodes base64 slot HTML as UTF-8", () => {
    const html = "<strong>안녕하세요 👋</strong>";
    const hook = createTestHook({
      "data-slots": JSON.stringify({ default: encodeBase64Utf8(html) }),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(reactElementProps(lastRenderedProps().children)).toMatchObject({
      dangerouslySetInnerHTML: { __html: html },
    });
  });

  it("rejects malformed UTF-8 slot payloads", () => {
    const hook = createTestHook({
      "data-slots": JSON.stringify({ default: "/w==" }),
    });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "valid base64-encoded UTF-8",
    );
  });

  it("maps named slots to React props and clears stale slot content on update", () => {
    const hook = createTestHook({
      "data-slots": JSON.stringify({
        default: btoa("<p>Body</p>"),
        header: btoa("<strong>Header</strong>"),
      }),
    });

    invoke(liveViewReactHook.mounted, hook);

    expect(reactElementProps(lastRenderedProps().children)).toMatchObject({
      "data-liveview-react-slot": "default",
      dangerouslySetInnerHTML: { __html: "<p>Body</p>" },
    });
    expect(reactElementProps(lastRenderedProps().header)).toMatchObject({
      "data-liveview-react-slot": "header",
      dangerouslySetInnerHTML: { __html: "<strong>Header</strong>" },
    });

    setAttributes(hook, {
      "data-props-diff": encodePatch([["add", "/header", []]]),
      "data-props-kind": "patch",
      "data-slots": JSON.stringify({
        default: btoa("<p>Updated</p>"),
      }),
      "data-streams-diff": "",
      "data-streams-kind": "patch",
    });
    invoke(liveViewReactHook.updated, hook);

    expect(lastRenderedProps().header).toEqual([]);
    expect(reactElementProps(lastRenderedProps().children)).toMatchObject({
      "data-liveview-react-slot": "default",
      dangerouslySetInnerHTML: { __html: "<p>Updated</p>" },
    });
  });

  it("rejects ordinary prop collisions with named slot props during mount", () => {
    const hook = createTestHook({
      "data-props": encodeProps({ header: "ordinary" }),
      "data-slots": JSON.stringify({
        header: btoa("<strong>Header</strong>"),
      }),
    });

    expect(() => invoke(liveViewReactHook.mounted, hook)).toThrow(
      "as both ordinary prop and slot prop",
    );
  });
});
