import {
  createElement,
  isValidElement,
  StrictMode,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHook,
  encodePatch,
  encodeProps,
  findElement,
  hydrationDescriptor,
  invoke,
  lastRenderedProps,
  renderMock,
  rootMock,
  setAttributes,
  TestComponent,
} from "./hooks.test-support";
import { createMockLiveViewHook } from "./tests/helpers";
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

  it("tears down an active runtime before reporting a lazy load failure", async () => {
    let rejectComponent!: (reason: unknown) => void;
    const componentPromise = new Promise<{ default: typeof TestComponent }>(
      (_resolve, reject) => {
        rejectComponent = reject;
      },
    );
    const queuedErrors: VoidFunction[] = [];
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
      queuedErrors.push(callback);
    });
    const lazyRuntime = createLiveViewReact({
      components: {
        LazyComponent: { load: () => componentPromise },
      },
    });
    const mockHook = createMockLiveViewHook({
      "data-component": "LazyComponent",
    });
    const element = document.createElement("section");
    for (const [name, value] of Object.entries({
      "data-component": "LazyComponent",
      "data-events": "{}",
      "data-liveview-react-version": "2",
      "data-props": "{}",
      "data-props-kind": "snapshot",
      "data-slots": "{}",
      "data-streams-kind": "snapshot",
      id: "lazy-load-failure",
    })) {
      element.setAttribute(name, value);
    }
    element.append(mockHook.target);
    document.body.append(element);
    const hook = { ...mockHook, el: element };

    invoke(lazyRuntime.hooks.LiveViewReactHook.mounted, hook);
    rejectComponent(new Error("load failed"));
    await componentPromise.catch(() => undefined);
    await Promise.resolve();

    hook.el.setAttribute("data-component", "AnotherComponent");
    expect(() =>
      invoke(lazyRuntime.hooks.LiveViewReactHook.updated, hook),
    ).not.toThrow();
    expect(vi.mocked(ReactDOM.createRoot)).not.toHaveBeenCalled();
    expect(queuedErrors).toHaveLength(1);
    expect(() => queuedErrors[0]?.()).toThrow(
      'Unable to load component "LazyComponent"',
    );
    for (const eventName of [
      "phx:before-navigate",
      "phx:page-loading-start",
      "phx:page-loading-stop",
    ]) {
      expect(
        removeEventListener.mock.calls.filter(
          ([removedName]) => removedName === eventName,
        ),
      ).toHaveLength(1);
    }

    invoke(lazyRuntime.hooks.LiveViewReactHook.destroyed, hook);
    element.remove();
    vi.restoreAllMocks();
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
