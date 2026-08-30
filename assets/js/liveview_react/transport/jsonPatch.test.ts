import { describe, expect, it } from "vitest";

import { applyPatch } from "./jsonPatch";

describe("applyPatch", () => {
  it("returns the original document for an empty patch", () => {
    const document = { stable: { value: true } };
    expect(applyPatch(document, [])).toBe(document);
  });

  it("applies object operations without mutating the input root", () => {
    const original = { keep: true, replace: "old", remove: "gone" };
    const result = applyPatch(original, [
      { op: "add", path: "/added", value: 1 },
      { op: "replace", path: "/replace", value: "new" },
      { op: "remove", path: "/remove" },
    ]);

    expect(result).not.toBe(original);
    expect(result).toEqual({ keep: true, replace: "new", added: 1 });
    expect(original).toEqual({ keep: true, replace: "old", remove: "gone" });
  });

  it("clones only the changed path and preserves untouched references", () => {
    const address = { city: "old" };
    const profile = { address, name: "Ada" };
    const stable = { theme: "dark" };
    const original = { profile, stable };

    const result = applyPatch(original, [
      { op: "replace", path: "/profile/address/city", value: "new" },
    ]);

    expect(result).not.toBe(original);
    expect(result.profile).not.toBe(profile);
    expect(result.profile.address).not.toBe(address);
    expect(result.profile.address).toEqual({ city: "new" });
    expect(result.stable).toBe(stable);
    expect(address.city).toBe("old");
  });

  it("preserves unaffected list item references", () => {
    const first = { id: 1, name: "first" };
    const second = { id: 2, name: "second" };
    const original = { items: [first, second] };

    const result = applyPatch(original, [
      { op: "replace", path: "/items/1/name", value: "changed" },
    ]);

    expect(result.items).not.toBe(original.items);
    expect(result.items[0]).toBe(first);
    expect(result.items[1]).not.toBe(second);
    expect(second.name).toBe("second");
  });

  it("keeps copy-on-write correct after array indexes shift", () => {
    const first = { name: "first" };
    const second = { name: "second" };
    const original = { items: [first, second] };

    const result = applyPatch(original, [
      { op: "replace", path: "/items/0/name", value: "changed-first" },
      { op: "remove", path: "/items/0" },
      { op: "replace", path: "/items/0/name", value: "changed-second" },
    ]);

    expect(result.items).toEqual([{ name: "changed-second" }]);
    expect(result.items[0]).not.toBe(second);
    expect(first.name).toBe("first");
    expect(second.name).toBe("second");
  });

  it("uses RFC array add, replace, remove, and append semantics", () => {
    const original = { items: ["a", "c"] };

    const result = applyPatch(original, [
      { op: "add", path: "/items/1", value: "b" },
      { op: "add", path: "/items/-", value: "d" },
      { op: "replace", path: "/items/2", value: "C" },
      { op: "remove", path: "/items/0" },
    ]);

    expect(result.items).toEqual(["b", "C", "d"]);
    expect(original.items).toEqual(["a", "c"]);
  });

  it("clones a caller-owned added value before a later nested update", () => {
    const inserted = { value: "before" };

    const result = applyPatch({ items: [] as Array<{ value: string }> }, [
      { op: "add", path: "/items/-", value: inserted },
      { op: "replace", path: "/items/0/value", value: "after" },
    ]);

    expect(result.items).toEqual([{ value: "after" }]);
    expect(result.items[0]).not.toBe(inserted);
    expect(inserted).toEqual({ value: "before" });
  });

  it("requires replace and remove targets to exist", () => {
    const original = { items: ["a"] };

    expect(() =>
      applyPatch(original, [{ op: "replace", path: "/missing", value: true }]),
    ).toThrow("does not resolve to a value");
    expect(() =>
      applyPatch(original, [{ op: "remove", path: "/items/1" }]),
    ).toThrow("out of bounds");
    expect(original).toEqual({ items: ["a"] });
  });

  it("supports document-root add, replace, and remove", () => {
    const added = { state: "added" };
    const replaced = { state: "replaced" };

    expect(
      applyPatch({ state: "old" }, [{ op: "add", path: "", value: added }]),
    ).toBe(added);
    expect(
      applyPatch({ state: "old" }, [
        { op: "replace", path: "", value: replaced },
      ]),
    ).toBe(replaced);
    expect(
      applyPatch({ state: "old" }, [{ op: "remove", path: "" }]),
    ).toBeNull();
  });

  it("handles escaped JSON Pointer property names", () => {
    const original = { "a/b~c": { value: "old" } };
    const result = applyPatch(original, [
      { op: "replace", path: "/a~1b~0c/value", value: "new" },
    ]);

    expect(result["a/b~c"]).toEqual({ value: "new" });
  });

  it("rejects stream frames with a dedicated routing error", () => {
    expect(() =>
      applyPatch({}, [{ op: "stream", path: "/rows", value: { items: [] } }]),
    ).toThrow("Stream frames must be applied through the stream transport");
  });

  it("rejects prototype-sensitive paths without prototype pollution", () => {
    const original = { safe: true };

    expect(() =>
      applyPatch(original, [
        { op: "add", path: "/__proto__", value: { local: true } },
      ]),
    ).toThrow("prototype-sensitive segment");
    expect(() =>
      applyPatch(original, [
        { op: "add", path: "/constructor", value: "local" },
      ]),
    ).toThrow("prototype-sensitive segment");
    expect(original).toEqual({ safe: true });
    expect(({} as Record<string, unknown>).local).toBeUndefined();
  });

  it.each([
    ["invalid pointer escape", "/items/~2", "replace"],
    ["non-canonical array index", "/items/01", "replace"],
    ["DOM-id selector", "/items/$$row", "replace"],
    ["out-of-range replace", "/items/2", "replace"],
    ["out-of-range add", "/items/2", "add"],
    ["out-of-range remove", "/items/2", "remove"],
    ["out-of-range traversal", "/items/2/value", "replace"],
    ["append replace", "/items/-", "replace"],
  ] as const)("rejects %s", (_label, path, op) => {
    expect(() =>
      applyPatch({ items: [1] }, [{ op, path, value: 2 }]),
    ).toThrow();
  });

  it("refuses inherited traversal", () => {
    expect(() =>
      applyPatch({}, [
        { op: "add", path: "/constructor/prototype/polluted", value: true },
      ]),
    ).toThrow("prototype-sensitive segment");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    [{ op: "copy", path: "/safe", value: true }, "unsupported op"],
    [{ op: "upsert", path: "/safe", value: true }, "unsupported op"],
    [{ op: "limit", path: "/safe", value: 1 }, "unsupported op"],
    [{ op: "add", path: "/safe" }, "requires a value"],
    [{ op: "remove", path: "/safe", value: true }, "must not contain a value"],
    [{ op: "add", path: "/safe", value: true, legacy: true }, "unknown field"],
  ])("rejects malformed operations: %o", (operation, message) => {
    expect(() => applyPatch({}, [operation] as never)).toThrow(message);
  });

  it("rejects symbol and accessor fields without invoking accessors", () => {
    let accessorRead = false;
    const accessorOperation = {
      path: "/safe",
      value: true,
    } as Record<string, unknown>;
    Object.defineProperty(accessorOperation, "op", {
      enumerable: true,
      get() {
        accessorRead = true;
        return "add";
      },
    });

    expect(() => applyPatch({}, [accessorOperation] as never)).toThrow(
      "enumerable data properties",
    );
    expect(accessorRead).toBe(false);

    const symbolOperation = {
      op: "add",
      path: "/safe",
      value: true,
      [Symbol("legacy")]: true,
    };
    expect(() => applyPatch({}, [symbolOperation] as never)).toThrow(
      "keys must be strings",
    );
  });

  it("rejects sparse, extended, and accessor patch arrays", () => {
    const sparse = new Array(1);
    expect(() => applyPatch({}, sparse as never)).toThrow(
      "dense and unextended",
    );

    const extended = [{ op: "add", path: "/safe", value: true }];
    Object.defineProperty(extended, "legacy", { value: true });
    expect(() => applyPatch({}, extended as never)).toThrow(
      "dense and unextended",
    );

    let accessorRead = false;
    const accessor = new Array(1);
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        accessorRead = true;
        return { op: "add", path: "/safe", value: true };
      },
    });
    expect(() => applyPatch({}, accessor as never)).toThrow("data elements");
    expect(accessorRead).toBe(false);
  });

  it("rejects non-data document properties without invoking accessors", () => {
    let accessorRead = false;
    const original = { safe: true } as Record<string, unknown>;
    Object.defineProperty(original, "computed", {
      enumerable: true,
      get() {
        accessorRead = true;
        return "unsafe";
      },
    });

    expect(() =>
      applyPatch(original, [{ op: "add", path: "/added", value: true }]),
    ).toThrow("enumerable data properties");
    expect(accessorRead).toBe(false);

    const symbolDocument = { safe: true, [Symbol("hidden")]: true };
    expect(() =>
      applyPatch(symbolDocument, [{ op: "add", path: "/added", value: true }]),
    ).toThrow("symbol key");
  });

  it("rejects sparse, extended, and accessor document arrays", () => {
    const sparse = new Array(2);
    sparse[0] = "a";
    expect(() =>
      applyPatch({ items: sparse }, [
        { op: "add", path: "/items/-", value: "b" },
      ]),
    ).toThrow("dense and unextended");

    const extended = ["a"] as unknown[] & { legacy?: boolean };
    extended.legacy = true;
    expect(() =>
      applyPatch({ items: extended }, [
        { op: "add", path: "/items/-", value: "b" },
      ]),
    ).toThrow("dense and unextended");

    let accessorRead = false;
    const accessor = ["a"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        accessorRead = true;
        return "a";
      },
    });
    expect(() =>
      applyPatch({ items: accessor }, [
        { op: "add", path: "/items/-", value: "b" },
      ]),
    ).toThrow("data elements");
    expect(accessorRead).toBe(false);
  });

  it("preserves references across a large nested update", () => {
    const rows = Array.from({ length: 1_000 }, (_, id) => ({
      id,
      meta: { label: `row-${id}` },
    }));
    const original = { rows, stable: { value: true } };

    const result = applyPatch(original, [
      { op: "replace", path: "/rows/731/meta/label", value: "changed" },
    ]);

    expect(result.rows).not.toBe(rows);
    expect(result.rows[730]).toBe(rows[730]);
    expect(result.rows[731]).not.toBe(rows[731]);
    expect(result.rows[731]?.meta).not.toBe(rows[731]?.meta);
    expect(result.rows[732]).toBe(rows[732]);
    expect(result.stable).toBe(original.stable);
  });
});
