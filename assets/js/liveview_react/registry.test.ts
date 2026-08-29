import { describe, expect, it, vi } from "vitest";

import { normalizeRegistry } from "./registry";

const Component = () => null;
const entry = { component: Component } as const;

describe("normalizeRegistry", () => {
  it("accepts ordinary and null-prototype registry objects", () => {
    expect(normalizeRegistry({ Component: entry })).toEqual({
      Component: entry,
    });

    const nullPrototype = Object.create(null) as Record<string, typeof entry>;
    nullPrototype.Component = entry;
    expect(normalizeRegistry(nullPrototype)).toEqual({ Component: entry });
  });

  it.each([null, [], new Map(), new (class Registry {})()])(
    "rejects a non-plain registry: %o",
    (registry) => {
      expect(() => normalizeRegistry(registry as never)).toThrow(
        "components must be a plain registry object",
      );
    },
  );

  it("rejects symbol, non-enumerable, and accessor registry keys", () => {
    expect(() =>
      normalizeRegistry({ [Symbol("Component")]: entry } as never),
    ).toThrow("keys must be enumerable strings");

    const hidden = Object.defineProperty({}, "Component", {
      enumerable: false,
      value: entry,
    });
    expect(() => normalizeRegistry(hidden as never)).toThrow(
      "keys must be enumerable data properties",
    );

    const accessor = Object.defineProperty({}, "Component", {
      enumerable: true,
      get: () => entry,
    });
    expect(() => normalizeRegistry(accessor as never)).toThrow(
      "keys must be enumerable data properties",
    );
  });

  it("rejects malformed tagged entries without invoking accessors", () => {
    expect(() => normalizeRegistry({ Component: [entry] } as never)).toThrow(
      "must use a tagged",
    );
    expect(() =>
      normalizeRegistry({
        Component: { component: Component, extra: true },
      } as never),
    ).toThrow("with no extra keys");
    expect(() =>
      normalizeRegistry({
        Component: {
          component: Component,
          load: async () => ({ default: Component }),
        },
      } as never),
    ).toThrow("with no extra keys");

    const getter = vi.fn(() => Component);
    const accessorEntry = Object.defineProperty({}, "component", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      normalizeRegistry({ Component: accessorEntry } as never),
    ).toThrow("must use an enumerable tagged data property");
    expect(getter).not.toHaveBeenCalled();

    expect(() =>
      normalizeRegistry({
        Component: {
          component: Component,
          [Symbol("extra")]: true,
        },
      } as never),
    ).toThrow("with no extra keys");
  });
});
