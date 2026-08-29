import { act, useEffect, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveViewReact } from "../context";
import type {
  LiveViewReactContextValue,
  LiveViewReactRootOptions,
} from "../types";
import { RootController, type RootRenderSnapshot } from "./root";

function createContext(element: HTMLElement): LiveViewReactContextValue {
  return {
    el: element,
    liveSocket: null,
    pushEvent: vi.fn(),
    pushEventTo: vi.fn(),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };
}

function snapshot(props: Record<string, unknown>): RootRenderSnapshot {
  return { children: [], props };
}

function createController(
  target: HTMLElement,
  initialSnapshot: RootRenderSnapshot,
  options: LiveViewReactRootOptions & {
    readonly hydrate?: boolean;
    readonly hydrationSnapshot?: RootRenderSnapshot;
  } = {},
) {
  const element = document.createElement("div");
  element.id = "react-root";
  element.append(target);

  return new RootController({
    ...options,
    componentName: "Stateful",
    context: createContext(element),
    element,
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
      const { el } = useLiveViewReact();
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

  it("uses server-visible context during hydration before publishing the live bridge", async () => {
    function ContextProbe() {
      const { el } = useLiveViewReact();
      return <p>{el?.id ?? "server"}</p>;
    }

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
    expect(target.textContent).toBe("react-root");
    await act(async () => controller.destroy());
  });
});
