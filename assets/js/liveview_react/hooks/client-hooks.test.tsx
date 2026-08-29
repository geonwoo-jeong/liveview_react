import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveViewReactProvider } from "../context";
import { LiveViewConnectionProvider } from "../runtime/connection-context";
import { createConnectionStore } from "../runtime/connection";
import type {
  EventPayload,
  LiveViewReactContextValue,
  PushEvent,
} from "../types";
import {
  LiveEventReplyCancelledError,
  LiveEventReplyTimeoutError,
  useEventReply,
  type UseEventReplyResult,
} from "./useEventReply";
import { useLiveConnection } from "./useLiveConnection";
import { useLiveEvent } from "./useLiveEvent";
import { useLiveNavigation, type LiveNavigation } from "./useLiveNavigation";

interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: TValue) => void;
}

function createDeferred<TValue>(): Deferred<TValue> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: TValue) => void;
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return { promise, reject, resolve };
}

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

describe("client hooks", () => {
  let root: Root;
  let rootMounted: boolean;
  let target: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    rootMounted = true;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (rootMounted) {
      await act(async () => root.unmount());
    }
    target.remove();
  });

  async function unmountRoot(): Promise<void> {
    await act(async () => root.unmount());
    rootMounted = false;
  }

  it("keeps one current useLiveEvent subscription in StrictMode and calls the latest handler", async () => {
    const activeCallbacks = new Set<(payload: string) => void>();
    const allCallbacks: ((payload: string) => void)[] = [];
    const deliveries: string[] = [];
    const handleEvent = vi.fn(
      (_event: string, callback: (payload: string) => void) => {
        activeCallbacks.add(callback);
        allCallbacks.push(callback);
        return callback;
      },
    );
    const removeHandleEvent = vi.fn((reference: unknown) => {
      activeCallbacks.delete(reference as (payload: string) => void);
    });

    function Probe({ label }: { readonly label: string }) {
      useLiveEvent("ping", (payload: string) => {
        deliveries.push(`${label}:${payload}`);
      });
      return null;
    }

    const bridge = createBridge({
      handleEvent: handleEvent as LiveViewReactContextValue["handleEvent"],
      removeHandleEvent,
    });
    await act(async () => {
      root.render(
        <StrictMode>
          <LiveViewReactProvider value={bridge}>
            <Probe label="first" />
          </LiveViewReactProvider>
        </StrictMode>,
      );
    });
    await act(async () => {
      root.render(
        <StrictMode>
          <LiveViewReactProvider value={bridge}>
            <Probe label="second" />
          </LiveViewReactProvider>
        </StrictMode>,
      );
    });
    await act(async () => {
      for (const callback of activeCallbacks) callback("value");
    });

    expect(handleEvent).toHaveBeenCalledTimes(2);
    expect(removeHandleEvent).toHaveBeenCalledTimes(1);
    expect(activeCallbacks.size).toBe(1);
    expect(deliveries).toEqual(["second:value"]);

    await unmountRoot();
    expect(removeHandleEvent).toHaveBeenCalledTimes(2);
    expect(activeCallbacks.size).toBe(0);
    for (const callback of allCallbacks) callback("late");
    expect(deliveries).toEqual(["second:value"]);
  });

  it("allows independent subscribers for the same LiveView event", async () => {
    const callbacks = new Set<(payload: number) => void>();
    const handleEvent = vi.fn(
      (_event: string, callback: (payload: number) => void) => {
        callbacks.add(callback);
        return callback;
      },
    );
    const removeHandleEvent = vi.fn((reference: unknown) => {
      callbacks.delete(reference as (payload: number) => void);
    });
    const received: string[] = [];

    function Probe({ name }: { readonly name: string }) {
      useLiveEvent("shared", (payload: number) => {
        received.push(`${name}:${payload}`);
      });
      return null;
    }

    const bridge = createBridge({
      handleEvent: handleEvent as LiveViewReactContextValue["handleEvent"],
      removeHandleEvent,
    });
    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe name="a" />
          <Probe name="b" />
        </LiveViewReactProvider>,
      );
    });
    await act(async () => {
      for (const callback of callbacks) callback(3);
    });

    expect(received).toEqual(["a:3", "b:3"]);
    await unmountRoot();
    expect(removeHandleEvent).toHaveBeenCalledTimes(2);
  });

  it("cancels the previous Promise request and ignores its late reply", async () => {
    const requests: Deferred<number>[] = [];
    const pushEvent = vi.fn((_event: string, _payload?: EventPayload) => {
      const request = createDeferred<number>();
      requests.push(request);
      return request.promise;
    });
    const bridge = createBridge({ pushEvent: pushEvent as PushEvent });
    const captured: {
      current?: UseEventReplyResult<number, number>;
    } = {};

    function Probe() {
      captured.current = useEventReply<number, number>("search", {
        initialData: 0,
      });
      return (
        <output data-loading={String(captured.current.isLoading)}>
          {captured.current.data}
        </output>
      );
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <LiveViewReactProvider value={bridge}>
            <Probe />
          </LiveViewReactProvider>
        </StrictMode>,
      );
    });
    const api = captured.current;
    if (!api) throw new Error("Expected useEventReply result");

    let firstPromise!: Promise<number>;
    await act(async () => {
      firstPromise = api.execute({ query: "first" });
    });
    const firstRejection = expect(firstPromise).rejects.toBeInstanceOf(
      LiveEventReplyCancelledError,
    );
    let secondPromise!: Promise<number>;
    await act(async () => {
      secondPromise = api.execute({ query: "second" });
    });

    await firstRejection;
    await act(async () => {
      requests[0]?.resolve(1);
      requests[1]?.resolve(2);
      await secondPromise;
    });

    await expect(secondPromise).resolves.toBe(2);
    expect(pushEvent.mock.calls).toEqual([
      ["search", { query: "first" }],
      ["search", { query: "second" }],
    ]);
    expect(target.textContent).toBe("2");
    expect(target.querySelector("output")?.dataset.loading).toBe("false");
  });

  it("keeps execute and cancel stable while reducing successful replies", async () => {
    const requests: Deferred<number>[] = [];
    const pushEvent = vi.fn(() => {
      const request = createDeferred<number>();
      requests.push(request);
      return request.promise;
    });
    const reduce = (current: readonly number[], reply: number) => [
      ...current,
      reply,
    ];
    const bridge = createBridge({ pushEvent: pushEvent as PushEvent });
    const captured: {
      current?: UseEventReplyResult<number, readonly number[]>;
    } = {};

    function Probe({ label }: { readonly label: string }) {
      captured.current = useEventReply<number, readonly number[]>("append", {
        initialData: [],
        reduce,
      });
      return (
        <output data-label={label}>{captured.current.data.join(",")}</output>
      );
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe label="first" />
        </LiveViewReactProvider>,
      );
    });
    const firstApi = captured.current;
    if (!firstApi) throw new Error("Expected useEventReply result");

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe label="second" />
        </LiveViewReactProvider>,
      );
    });
    const secondApi = captured.current;
    if (!secondApi) throw new Error("Expected updated useEventReply result");
    expect(secondApi.execute).toBe(firstApi.execute);
    expect(secondApi.cancel).toBe(firstApi.cancel);

    let firstPromise!: Promise<number>;
    await act(async () => {
      firstPromise = secondApi.execute();
    });
    await act(async () => {
      requests[0]?.resolve(4);
      await firstPromise;
    });

    const latestApi = captured.current;
    if (!latestApi) throw new Error("Expected reduced useEventReply result");
    expect(latestApi.data).toEqual([4]);
    expect(target.textContent).toBe("4");
  });

  it("times out a request and exposes the timeout error", async () => {
    vi.useFakeTimers();
    const bridge = createBridge({
      pushEvent: vi.fn(() => new Promise(() => {})) as PushEvent,
    });
    const captured: { current?: UseEventReplyResult<number> } = {};

    function Probe() {
      captured.current = useEventReply<number>("search", { timeout: 25 });
      return (
        <output data-error={String(captured.current.error !== null)}>
          {captured.current.data ?? "empty"}
        </output>
      );
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe />
        </LiveViewReactProvider>,
      );
    });
    const api = captured.current;
    if (!api) throw new Error("Expected useEventReply result");
    let promise!: Promise<number>;
    await act(async () => {
      promise = api.execute();
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(
      LiveEventReplyTimeoutError,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });

    await rejection;
    expect(captured.current?.error).toBeInstanceOf(LiveEventReplyTimeoutError);
    expect(target.querySelector("output")?.dataset.error).toBe("true");
  });

  it("cancels an active request explicitly and ignores its reply", async () => {
    const request = createDeferred<number>();
    const bridge = createBridge({
      pushEvent: vi.fn(() => request.promise) as PushEvent,
    });
    const captured: { current?: UseEventReplyResult<number> } = {};

    function Probe() {
      captured.current = useEventReply<number>("cancel-me");
      return (
        <output data-loading={String(captured.current.isLoading)}>
          {captured.current.data ?? "empty"}
        </output>
      );
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe />
        </LiveViewReactProvider>,
      );
    });
    const api = captured.current;
    if (!api) throw new Error("Expected useEventReply result");
    let promise!: Promise<number>;
    await act(async () => {
      promise = api.execute();
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(
      LiveEventReplyCancelledError,
    );

    await act(async () => api.cancel());
    await rejection;
    request.resolve(9);
    await Promise.resolve();

    expect(captured.current?.error).toBeInstanceOf(
      LiveEventReplyCancelledError,
    );
    expect(target.textContent).toBe("empty");
    expect(target.querySelector("output")?.dataset.loading).toBe("false");
  });

  it("cancels on unmount and never reduces a late reply", async () => {
    const request = createDeferred<number>();
    const reduce = vi.fn((current: number, reply: number) => current + reply);
    const bridge = createBridge({
      pushEvent: vi.fn(() => request.promise) as PushEvent,
    });
    const captured: { current?: UseEventReplyResult<number, number> } = {};

    function Probe() {
      captured.current = useEventReply<number, number>("slow", {
        initialData: 0,
        reduce,
      });
      return null;
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <Probe />
        </LiveViewReactProvider>,
      );
    });
    const api = captured.current;
    if (!api) throw new Error("Expected useEventReply result");
    let promise!: Promise<number>;
    await act(async () => {
      promise = api.execute();
    });
    const rejection = expect(promise).rejects.toBeInstanceOf(
      LiveEventReplyCancelledError,
    );

    await unmountRoot();
    request.resolve(8);
    await rejection;
    await Promise.resolve();

    expect(reduce).not.toHaveBeenCalled();
  });

  it("publishes connection state transitions through useLiveConnection", async () => {
    const store = createConnectionStore();

    function Probe() {
      const connection = useLiveConnection();
      return (
        <output>
          {connection.connected ? "connected" : "disconnected"}:
          {connection.reconnecting ? "reconnecting" : "stable"}
        </output>
      );
    }

    await act(async () => {
      root.render(
        <LiveViewConnectionProvider store={store}>
          <Probe />
        </LiveViewConnectionProvider>,
      );
    });
    expect(target.textContent).toBe("connected:stable");

    await act(async () => store.setDisconnected());
    expect(target.textContent).toBe("disconnected:reconnecting");

    await act(async () => store.setConnected());
    expect(target.textContent).toBe("connected:stable");
  });

  it("renders useLiveNavigation without a bridge and throws only on invocation", () => {
    const captured: { current?: LiveNavigation } = {};

    function Probe() {
      captured.current = useLiveNavigation();
      return <span>server render</span>;
    }

    expect(renderToStaticMarkup(<Probe />)).toBe("<span>server render</span>");
    expect(() => captured.current?.patch("/settings")).toThrow(
      "LiveView navigation is unavailable without a connected LiveView bridge",
    );
  });

  it("keeps live navigation stable and delegates to the current public js commands", async () => {
    const navigate = vi.fn();
    const patch = vi.fn();
    const disconnectedBridge = createBridge();
    const connectedBridge = createBridge({
      liveSocket: { js: () => ({ navigate, patch }) },
    });
    const captured: { current?: LiveNavigation } = {};

    function Probe() {
      captured.current = useLiveNavigation();
      return null;
    }

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={disconnectedBridge}>
          <Probe />
        </LiveViewReactProvider>,
      );
    });
    const firstNavigation = captured.current;
    if (!firstNavigation) throw new Error("Expected live navigation result");
    expect(() => firstNavigation.patch("/offline")).toThrow(
      "LiveView navigation is unavailable without a connected LiveView bridge",
    );

    await act(async () => {
      root.render(
        <LiveViewReactProvider value={connectedBridge}>
          <Probe />
        </LiveViewReactProvider>,
      );
    });
    const connectedNavigation = captured.current;
    if (!connectedNavigation) {
      throw new Error("Expected connected live navigation result");
    }

    expect(connectedNavigation).toBe(firstNavigation);
    connectedNavigation.patch("/users?page=2", { replace: true });
    connectedNavigation.navigate("/settings");
    expect(patch).toHaveBeenCalledWith("/users?page=2", { replace: true });
    expect(navigate).toHaveBeenCalledWith("/settings", undefined);
  });
});
