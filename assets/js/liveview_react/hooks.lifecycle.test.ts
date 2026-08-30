import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHook,
  encodeProps,
  expectLifecycleFailure,
  invoke,
  lastRenderedProps,
  renderMock,
  rootMock,
  setAttributes,
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

    expectLifecycleFailure(
      () => invoke(liveViewReactHook.mounted, hook),
      "requires exactly one direct [data-react-target] child element",
    );
  });

  it("rejects multiple direct React-owned targets", () => {
    const hook = createTestHook();
    hook.el.querySelectorAll.mockReturnValue([
      hook.target,
      document.createElement("div"),
    ] as never);

    expectLifecycleFailure(
      () => invoke(liveViewReactHook.mounted, hook),
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

  it("rejects a root with an empty id", () => {
    const hook = createTestHook({ id: "" });

    expectLifecycleFailure(
      () => invoke(liveViewReactHook.mounted, hook),
      "requires a non-empty element id",
    );
  });

  it.each(["updated", "reconnected"] as const)(
    "rejects a component identity change during %s",
    (phase) => {
      const hook = createTestHook();
      invoke(liveViewReactHook.mounted, hook);
      hook.el.setAttribute("data-component", "AnotherComponent");

      expectLifecycleFailure(
        () => invoke(liveViewReactHook[phase], hook),
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

      expectLifecycleFailure(
        () => invoke(liveViewReactHook[phase], hook),
        "LiveView root id cannot change",
      );
    },
  );

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

  // LiveView drives every hook's updated() from one loop inside performPatch.
  // A callback that threw synchronously would abort that loop, so a sibling
  // root later in the same patch would silently stop receiving updates.
  it("keeps updating sibling roots when one root fails in the same patch", () => {
    const renderA = vi.fn();
    const rootA = { render: renderA, unmount: vi.fn() };
    const renderB = vi.fn();
    const rootB = { render: renderB, unmount: vi.fn() };
    vi.mocked(ReactDOM.createRoot)
      .mockImplementationOnce(() => rootA)
      .mockImplementationOnce(() => rootB);
    const hookA = createTestHook({ id: "root-a" });
    const hookB = createTestHook({ id: "root-b" });

    invoke(liveViewReactHook.mounted, hookA);
    invoke(liveViewReactHook.mounted, hookB);
    renderA.mockClear();
    renderB.mockClear();

    // Root A's transport becomes unreadable; root B receives a valid update.
    setAttributes(hookA, { "data-props-kind": "corrupt" });
    setAttributes(hookB, {
      "data-props": encodeProps({ title: "B updated" }),
    });

    const queued: VoidFunction[] = [];
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback: VoidFunction) => {
        queued.push(callback);
      });

    try {
      // Exactly how LiveView iterates: no try/catch around the callbacks.
      for (const hook of [hookA, hookB]) {
        invoke(liveViewReactHook.updated, hook);
      }
    } finally {
      queueMicrotaskSpy.mockRestore();
    }

    // The sibling root was still reached and rendered the new props.
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(lastRenderedProps(renderB)).toMatchObject({ title: "B updated" });

    // The failing root was torn down exactly once and never re-rendered.
    expect(rootA.unmount).toHaveBeenCalledTimes(1);
    expect(renderA).not.toHaveBeenCalled();
    expect(rootB.unmount).not.toHaveBeenCalled();

    // The failure is reported exactly once, asynchronously.
    expect(queued).toHaveLength(1);
    expect(() => queued[0]?.()).toThrow();
  });

  it("reports a repeated failure on an already destroyed root only once", () => {
    const hook = createTestHook();
    invoke(liveViewReactHook.mounted, hook);
    setAttributes(hook, { "data-props-kind": "corrupt" });

    const queued: VoidFunction[] = [];
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback: VoidFunction) => {
        queued.push(callback);
      });

    try {
      invoke(liveViewReactHook.updated, hook);
      invoke(liveViewReactHook.updated, hook);
      invoke(liveViewReactHook.updated, hook);
    } finally {
      queueMicrotaskSpy.mockRestore();
    }

    expect(rootMock.unmount).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(1);
  });
});
