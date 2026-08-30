import {
  act,
  Component,
  createContext,
  createRef,
  forwardRef,
  useContext,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LiveViewReactContextValue,
  LiveViewReactRootOptions,
} from "../types";
import { RootController, type RootRenderSnapshot } from "./root";

function createBridgeContext(element: HTMLElement): LiveViewReactContextValue {
  return {
    el: element,
    liveSocket: null,
    pushEvent: vi.fn(() =>
      Promise.resolve(undefined),
    ) as unknown as LiveViewReactContextValue["pushEvent"],
    pushEventTo: vi.fn(() => Promise.resolve([])),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };
}

function snapshot(props: Record<string, unknown>): RootRenderSnapshot {
  return { children: [], events: {}, props };
}

function createController(
  target: HTMLElement,
  initialSnapshot: RootRenderSnapshot,
  options: Pick<
    LiveViewReactRootOptions,
    "onCaughtError" | "onRecoverableError" | "onUncaughtError"
  > = {},
) {
  const element = document.createElement("div");
  element.id = "compatibility-root";
  element.append(target);

  return new RootController({
    ...options,
    componentName: "CompatibilityProbe",
    context: createBridgeContext(element),
    element,
    executeEventCommands: vi.fn(),
    hydrate: false,
    initialSnapshot,
    target,
  });
}

describe("RootController React compatibility", () => {
  beforeEach(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("preserves class state and forwarded refs across server updates", async () => {
    const inputRef = createRef<HTMLInputElement>();
    const ForwardedInput = forwardRef<
      HTMLInputElement,
      { readonly label: string }
    >(function ForwardedInput({ label }, ref) {
      return <input aria-label={label} defaultValue="initial" ref={ref} />;
    });

    class StatefulClass extends Component<
      { readonly label: string },
      { readonly count: number }
    > {
      override readonly state = { count: 0 };

      override render() {
        return (
          <section>
            <button
              type="button"
              onClick={() =>
                this.setState(({ count }) => ({ count: count + 1 }))
              }
            >
              {this.props.label}:{this.state.count}
            </button>
            <ForwardedInput label={this.props.label} ref={inputRef} />
          </section>
        );
      }
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({ label: "first" }));

    await act(async () => controller.mount(StatefulClass));
    const firstInput = inputRef.current;
    expect(firstInput).not.toBeNull();

    await act(async () => {
      target.querySelector("button")!.click();
      firstInput!.value = "typed";
    });
    await act(async () => controller.update(snapshot({ label: "second" })));

    expect(target.querySelector("button")?.textContent).toBe("second:1");
    expect(inputRef.current).toBe(firstInput);
    expect(inputRef.current?.value).toBe("typed");
    expect(inputRef.current?.ariaLabel).toBe("second");
    await act(async () => controller.destroy());
  });

  it("preserves user context and synthetic event bubbling through portals", async () => {
    const UserContext = createContext("missing");
    const recordPortal = vi.fn();
    const recordOwner = vi.fn();
    const portalHost = document.createElement("div");
    document.body.append(portalHost);

    function PortalButton() {
      const value = useContext(UserContext);
      return (
        <button type="button" onClick={recordPortal}>
          {value}
        </button>
      );
    }

    function PortalOwner({ value }: { readonly value: string }) {
      return (
        <UserContext value={value}>
          <div onClick={recordOwner}>
            {createPortal(<PortalButton />, portalHost)}
          </div>
        </UserContext>
      );
    }

    const target = document.createElement("div");
    const controller = createController(
      target,
      snapshot({ value: "user-context" }),
    );

    try {
      await act(async () => controller.mount(PortalOwner));
      const button = portalHost.querySelector("button");
      expect(button?.textContent).toBe("user-context");

      await act(async () => button!.click());

      expect(recordPortal).toHaveBeenCalledOnce();
      expect(recordOwner).toHaveBeenCalledOnce();
      expect(recordPortal.mock.invocationCallOrder[0]!).toBeLessThan(
        recordOwner.mock.invocationCallOrder[0]!,
      );
    } finally {
      await act(async () => controller.destroy());
      portalHost.remove();
    }
  });

  it("reports errors caught by a class boundary to the React root callback", async () => {
    const caughtError = new Error("caught by boundary");
    const onCaughtError = vi.fn();
    const onUncaughtError = vi.fn();

    class ErrorBoundary extends Component<
      { readonly children: ReactNode },
      { readonly failed: boolean }
    > {
      override readonly state = { failed: false };

      static getDerivedStateFromError() {
        return { failed: true };
      }

      override render() {
        return this.state.failed ? <p>fallback</p> : this.props.children;
      }
    }

    function CaughtFailure(): never {
      throw caughtError;
    }

    function BoundedFailure() {
      return (
        <ErrorBoundary>
          <CaughtFailure />
        </ErrorBoundary>
      );
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}), {
      onCaughtError,
      onUncaughtError,
    });

    try {
      await act(async () => controller.mount(BoundedFailure));

      expect(target.textContent).toBe("fallback");
      expect(onCaughtError).toHaveBeenCalledTimes(1);
      expect(onCaughtError.mock.calls[0]?.[0]).toBe(caughtError);
      expect(onCaughtError.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ componentStack: expect.any(String) }),
      );
      expect(onUncaughtError).not.toHaveBeenCalled();
    } finally {
      await act(async () => controller.destroy());
    }
  });

  it("reports a recoverable hydration mismatch to the React root callback", async () => {
    const onRecoverableError = vi.fn();
    const target = document.createElement("div");
    target.innerHTML = "<p>server content</p>";
    const element = document.createElement("div");
    element.id = "compatibility-hydration-root";
    element.append(target);
    const initialSnapshot = snapshot({});
    const controller = new RootController({
      componentName: "HydrationMismatchProbe",
      context: createBridgeContext(element),
      element,
      executeEventCommands: vi.fn(),
      hydrate: true,
      hydrationSnapshot: initialSnapshot,
      initialSnapshot,
      onRecoverableError,
      target,
    });

    try {
      await act(async () => controller.mount(() => <p>client content</p>));

      expect(target.textContent).toBe("client content");
      expect(onRecoverableError).toHaveBeenCalledOnce();
      expect(onRecoverableError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect(onRecoverableError.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ componentStack: expect.any(String) }),
      );
    } finally {
      await act(async () => controller.destroy());
    }
  });

  it("reports errors without a boundary to the uncaught root callback", async () => {
    const uncaughtError = new Error("uncaught by root");
    const onCaughtError = vi.fn();
    const onUncaughtError = vi.fn();

    function UnboundedFailure(): never {
      throw uncaughtError;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}), {
      onCaughtError,
      onUncaughtError,
    });

    try {
      // React's test-only act queue rethrows uncaught errors before invoking the
      // configured root callback, so flush synchronously through the real path.
      flushSync(() => controller.mount(UnboundedFailure));

      expect(target.childElementCount).toBe(0);
      expect(onUncaughtError).toHaveBeenCalledTimes(1);
      expect(onUncaughtError.mock.calls[0]?.[0]).toBe(uncaughtError);
      expect(onUncaughtError.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ componentStack: expect.any(String) }),
      );
      expect(onCaughtError).not.toHaveBeenCalled();
    } finally {
      await act(async () => controller.destroy());
    }
  });
});
