import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHook,
  encodeProps,
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
});
