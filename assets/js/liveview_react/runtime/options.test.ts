import { describe, expect, it, vi } from "vitest";

import { createLiveViewReact } from "../index";
import { createLiveViewReactServer } from "../server";

const Component = () => null;
const components = { Component: { component: Component } } as const;

describe("factory option validation", () => {
  it("rejects non-object options and missing components", () => {
    expect(() => createLiveViewReact(null as never)).toThrow(
      "liveview_react options must be a plain object",
    );
    expect(() => createLiveViewReact({} as never)).toThrow(
      "components is required",
    );
  });

  it.each([
    ["strictMode", "yes", "strictMode must be a boolean"],
    ["wrapRoot", {}, "wrapRoot must be a function"],
    ["onCaughtError", null, "onCaughtError must be a function"],
    ["onRecoverableError", false, "onRecoverableError must be a function"],
    ["onUncaughtError", 1, "onUncaughtError must be a function"],
  ])("rejects invalid client %s values", (key, value, message) => {
    expect(() =>
      createLiveViewReact({ components, [key]: value } as never),
    ).toThrow(message);
  });

  it("rejects unknown and symbol client option keys", () => {
    expect(() =>
      createLiveViewReact({ components, unexpected: true } as never),
    ).toThrow('Unknown liveview_react option "unexpected"');

    expect(() =>
      createLiveViewReact({
        components,
        [Symbol("unexpected")]: true,
      } as never),
    ).toThrow("liveview_react options must use string keys");
  });

  it("rejects prototype and accessor option objects without invoking accessors", () => {
    expect(() =>
      createLiveViewReact(new (class Options {})() as never),
    ).toThrow("options must be a plain object");

    const getter = vi.fn(() => components);
    const options = Object.defineProperty({}, "components", {
      enumerable: true,
      get: getter,
    });
    expect(() => createLiveViewReact(options as never)).toThrow(
      "options must use enumerable data properties",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("accepts valid client root options", () => {
    expect(() =>
      createLiveViewReact({
        components,
        onCaughtError: vi.fn(),
        onRecoverableError: vi.fn(),
        onUncaughtError: vi.fn(),
        strictMode: true,
        wrapRoot: ({ children }) => children,
      }),
    ).not.toThrow();
  });

  it.each(["onCaughtError", "onRecoverableError", "onUncaughtError"])(
    "rejects client-only server option %s at runtime",
    (key) => {
      expect(() =>
        createLiveViewReactServer({
          components,
          [key]: vi.fn(),
        } as never),
      ).toThrow(`${key} is a client-only liveview_react option`);
    },
  );

  it("rejects invalid and unknown server options", () => {
    expect(() =>
      createLiveViewReactServer({ components, strictMode: 1 } as never),
    ).toThrow("strictMode must be a boolean");
    expect(() =>
      createLiveViewReactServer({ components, unknown: true } as never),
    ).toThrow('Unknown liveview_react option "unknown"');
  });
});
