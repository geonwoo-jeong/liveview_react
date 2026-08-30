import { act, Suspense, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveViewReactProvider } from "../context";
import type { LiveViewReactContextValue, PushEvent } from "../types";
import { useLiveEvent } from "./useLiveEvent";

function createBridge(
  overrides: Partial<LiveViewReactContextValue> = {},
): LiveViewReactContextValue {
  return {
    el: document.createElement("div"),
    liveSocket: null,
    pushEvent: vi.fn(() => Promise.resolve(null)) as PushEvent,
    pushEventTo: vi.fn(() => Promise.resolve([])),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
    ...overrides,
  };
}

describe("useLiveEvent", () => {
  const reactEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  let previousActEnvironment: boolean | undefined;
  let root: Root;
  let rootMounted: boolean;
  let target: HTMLDivElement;

  beforeEach(() => {
    previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    rootMounted = true;
  });

  afterEach(async () => {
    try {
      if (rootMounted) {
        await act(async () => root.unmount());
      }
    } finally {
      target.remove();
      if (previousActEnvironment === undefined) {
        delete reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  });

  it("publishes only committed handlers across a suspended concurrent render", async () => {
    const activeCallbacks = new Set<(payload: string) => void>();
    const deliveries: string[] = [];
    const handleEvent = vi.fn(
      (_event: string, callback: (payload: string) => void) => {
        activeCallbacks.add(callback);
        return callback;
      },
    );
    const removeHandleEvent = vi.fn((reference: unknown) => {
      activeCallbacks.delete(reference as (payload: string) => void);
    });
    const bridge = createBridge({
      handleEvent: handleEvent as LiveViewReactContextValue["handleEvent"],
      removeHandleEvent,
    });
    let release!: () => void;
    let ready = false;
    const pending = new Promise<void>((resolve) => {
      release = () => {
        ready = true;
        resolve();
      };
    });

    function Probe({
      blocked,
      label,
    }: Readonly<{ blocked: boolean; label: string }>) {
      useLiveEvent("ping", (payload: string) => {
        deliveries.push(`${label}:${payload}`);
      });
      if (blocked && !ready) throw pending;
      return null;
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Suspense fallback={<span>pending</span>}>
            <Probe blocked={false} label="committed" />
          </Suspense>
        </LiveViewReactProvider>,
      );
    });

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Suspense fallback={<span>pending</span>}>
            <Probe blocked label="pending" />
          </Suspense>
        </LiveViewReactProvider>,
      );
    });
    for (const callback of activeCallbacks) callback("before-release");
    expect(deliveries).toEqual(["committed:before-release"]);

    await act(async () => {
      release();
      await pending;
    });
    for (const callback of activeCallbacks) callback("after-release");

    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(removeHandleEvent).not.toHaveBeenCalled();
    expect(deliveries).toEqual([
      "committed:before-release",
      "pending:after-release",
    ]);

    await act(async () => root.unmount());
    rootMounted = false;
    expect(removeHandleEvent).toHaveBeenCalledTimes(1);
    expect(activeCallbacks.size).toBe(0);
  });

  it("publishes the latest handler before descendant layout effects run", async () => {
    const activeCallbacks = new Set<(payload: string) => void>();
    const deliveries: string[] = [];
    const handleEvent = vi.fn(
      (_event: string, callback: (payload: string) => void) => {
        activeCallbacks.add(callback);
        return callback;
      },
    );
    const removeHandleEvent = vi.fn((reference: unknown) => {
      activeCallbacks.delete(reference as (payload: string) => void);
    });
    const bridge = createBridge({
      handleEvent: handleEvent as LiveViewReactContextValue["handleEvent"],
      removeHandleEvent,
    });

    function Probe({
      emit,
      label,
    }: Readonly<{ emit: boolean; label: string }>) {
      useLiveEvent("ping", (payload: string) => {
        deliveries.push(`${label}:${payload}`);
      });
      useLayoutEffect(() => {
        if (!emit) return;
        for (const callback of activeCallbacks) callback("layout");
      }, [emit]);
      return null;
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe emit={false} label="initial" />
        </LiveViewReactProvider>,
      );
    });
    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe emit label="latest" />
        </LiveViewReactProvider>,
      );
    });

    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(removeHandleEvent).not.toHaveBeenCalled();
    expect(deliveries).toEqual(["latest:layout"]);
  });

  it("does not subscribe or warn during server rendering", () => {
    const handleEvent = vi.fn();
    const removeHandleEvent = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const bridge = createBridge({ handleEvent, removeHandleEvent });

    function Probe() {
      useLiveEvent("ping", () => {});
      return <span>server render</span>;
    }

    try {
      expect(
        renderToStaticMarkup(
          <LiveViewReactProvider value={bridge}>
            <Probe />
          </LiveViewReactProvider>,
        ),
      ).toBe("<span>server render</span>");
      expect(handleEvent).not.toHaveBeenCalled();
      expect(removeHandleEvent).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
