import { describe, expect, it, vi } from "vitest";

import { createConnectionStore } from "./connection";

describe("createConnectionStore", () => {
  it("provides stable frozen client and server snapshots", () => {
    const store = createConnectionStore();
    const connected = store.getSnapshot();
    const server = store.getServerSnapshot();

    expect(connected).toEqual({ connected: true, reconnecting: false });
    expect(store.getSnapshot()).toBe(connected);
    expect(Object.isFrozen(connected)).toBe(true);

    expect(server).toEqual({ connected: false, reconnecting: false });
    expect(store.getServerSnapshot()).toBe(server);
    expect(Object.isFrozen(server)).toBe(true);
    expect(Object.isFrozen(store)).toBe(true);
  });

  it("publishes immutable disconnected and reconnected snapshots", () => {
    const store = createConnectionStore();
    const connected = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setDisconnected();
    const disconnected = store.getSnapshot();

    expect(disconnected).toEqual({ connected: false, reconnecting: true });
    expect(disconnected).not.toBe(connected);
    expect(Object.isFrozen(disconnected)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setConnected();

    expect(store.getSnapshot()).toBe(connected);
    expect(listener).toHaveBeenCalledTimes(2);

    store.setDisconnected();

    expect(store.getSnapshot()).toBe(disconnected);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not notify or replace snapshots for idempotent transitions", () => {
    const store = createConnectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const connected = store.getSnapshot();
    store.setConnected();
    store.setConnected();

    expect(store.getSnapshot()).toBe(connected);
    expect(listener).not.toHaveBeenCalled();

    store.setDisconnected();
    const disconnected = store.getSnapshot();
    store.setDisconnected();
    store.setDisconnected();

    expect(store.getSnapshot()).toBe(disconnected);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("balances subscribe, cleanup, and resubscribe like StrictMode", () => {
    const store = createConnectionStore();
    const listener = vi.fn();

    const firstCleanup = store.subscribe(listener);
    firstCleanup();
    firstCleanup();

    store.setDisconnected();
    expect(listener).not.toHaveBeenCalled();

    const secondCleanup = store.subscribe(listener);
    store.setConnected();
    expect(listener).toHaveBeenCalledTimes(1);

    secondCleanup();
    store.setDisconnected();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears subscriptions on destroy and ignores later transitions", () => {
    const store = createConnectionStore();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribe(firstListener);
    store.subscribe(secondListener);

    const snapshotBeforeDestroy = store.getSnapshot();
    store.destroy();
    store.destroy();
    store.setDisconnected();
    store.setConnected();

    expect(store.getSnapshot()).toBe(snapshotBeforeDestroy);
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();

    const lateListener = vi.fn();
    const cleanup = store.subscribe(lateListener);
    cleanup();
    store.setDisconnected();

    expect(lateListener).not.toHaveBeenCalled();
  });
});
