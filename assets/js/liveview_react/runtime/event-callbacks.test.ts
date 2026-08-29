import { describe, expect, it, vi } from "vitest";

import {
  assertNoEventPropCollisions,
  createUnavailableEventCallbacks,
  EventCallbackCache,
  normalizeEventCommandMap,
} from "./event-callbacks";

function commands(value: unknown) {
  return normalizeEventCommandMap(value, "test events");
}

describe("event callbacks", () => {
  it("executes the full command chain and merges payload over every push value", () => {
    const exec = vi.fn();
    const liveSocket = { js: vi.fn(() => ({ exec })) };
    const element = document.createElement("div");
    const original = {
      onIncrement: [
        [
          "push",
          { event: "increment", value: { retained: true, shared: "static" } },
        ],
        ["add_class", { names: ["pending"], to: "#counter" }],
        ["push", { event: "audit", value: { audit: true, shared: "second" } }],
      ],
    };
    const eventCommands = commands(original);
    const cache = new EventCallbackCache({ element, liveSocket });

    cache.update(eventCommands).onIncrement?.({
      count: 2,
      shared: "payload",
    });

    expect(exec).toHaveBeenCalledWith(element, [
      [
        "push",
        {
          event: "increment",
          value: { retained: true, count: 2, shared: "payload" },
        },
      ],
      ["add_class", { names: ["pending"], to: "#counter" }],
      [
        "push",
        {
          event: "audit",
          value: { audit: true, count: 2, shared: "payload" },
        },
      ],
    ]);
    expect(original).toEqual({
      onIncrement: [
        [
          "push",
          { event: "increment", value: { retained: true, shared: "static" } },
        ],
        ["add_class", { names: ["pending"], to: "#counter" }],
        ["push", { event: "audit", value: { audit: true, shared: "second" } }],
      ],
    });
  });

  it("keeps unchanged callback references and replaces changed or removed callbacks", () => {
    const exec = vi.fn();
    const cache = new EventCallbackCache({
      element: document.createElement("div"),
      liveSocket: { js: () => ({ exec }) },
    });
    const first = cache.update(
      commands({
        onIncrement: [["push", { event: "increment" }]],
        onReset: [["push", { event: "reset" }]],
      }),
    );
    const unchanged = cache.update(
      commands({
        onIncrement: [["push", { event: "increment" }]],
        onReset: [["push", { event: "reset" }]],
      }),
    );
    const changed = cache.update(
      commands({
        onIncrement: [["push", { event: "increment-v2" }]],
      }),
    );

    expect(unchanged.onIncrement).toBe(first.onIncrement);
    expect(unchanged.onReset).toBe(first.onReset);
    expect(changed.onIncrement).not.toBe(first.onIncrement);
    expect(changed).not.toHaveProperty("onReset");

    first.onIncrement?.();
    first.onReset?.();
    expect(exec).not.toHaveBeenCalled();

    changed.onIncrement?.();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("makes retained callbacks inert when their root cache is destroyed", () => {
    const exec = vi.fn();
    const cache = new EventCallbackCache({
      element: document.createElement("div"),
      liveSocket: { js: () => ({ exec }) },
    });
    const retained = cache.update(
      commands({ onIncrement: [["push", { event: "increment" }]] }),
    ).onIncrement!;

    cache.destroy();
    retained();

    expect(exec).not.toHaveBeenCalled();
    expect(() => cache.update(commands({}))).toThrow("destroyed");
  });

  it("rejects non-object or non-JSON callback payloads before execution", () => {
    const exec = vi.fn();
    const callback = new EventCallbackCache({
      element: document.createElement("div"),
      liveSocket: { js: () => ({ exec }) },
    }).update(
      commands({ onIncrement: [["push", { event: "increment" }]] }),
    ).onIncrement!;

    for (const payload of [null, [], "value", new Date()] as unknown[]) {
      expect(() => callback(payload as never)).toThrow(
        "payload must be a plain JSON object",
      );
    }
    expect(() => callback({ invalid: undefined } as never)).toThrow(
      "must contain only JSON values",
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("requires the current public LiveSocket js().exec API", () => {
    const callback = new EventCallbackCache({
      element: document.createElement("div"),
      liveSocket: {},
    }).update(
      commands({ onIncrement: [["push", { event: "increment" }]] }),
    ).onIncrement!;

    expect(() => callback()).toThrow("public js().exec API");
  });

  it("creates explicit failure callbacks for server rendering and hydration", () => {
    const callback = createUnavailableEventCallbacks(
      commands({ onIncrement: [["push", { event: "increment" }]] }),
    ).onIncrement!;

    expect(() => callback()).toThrow(
      'Event callback "onIncrement" is unavailable during server rendering or hydration',
    );
  });

  it.each([
    [[], "must contain a JSON object"],
    [{ increment: [] }, "must be a React onCamelCase prop name"],
    [{ onIncrement: {} }, "must be a Phoenix JS command array"],
    [{ onIncrement: [["PUSH", {}]] }, "lowercase command name"],
    [{ onIncrement: [["push"]] }, "[operation, options] tuple"],
    [{ onIncrement: [["push", []]] }, "plain JSON object"],
  ])("strictly validates event metadata %#", (value, message) => {
    expect(() => commands(value)).toThrow(message);
  });

  it("rejects collisions with ordinary props", () => {
    const events = commands({
      onIncrement: [["push", { event: "increment" }]],
    });

    expect(() =>
      assertNoEventPropCollisions(
        { onIncrement: "ordinary" },
        events,
        "test request",
      ),
    ).toThrow('ordinary prop "onIncrement"');
  });
});
