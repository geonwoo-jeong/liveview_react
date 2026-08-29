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

  it("supports stream upsert, removal, and limits", () => {
    const first = { __dom_id: "a", value: 1 };
    const original = { rows: [first] };

    const result = applyPatch(original, [
      { op: "upsert", path: "/rows/-", value: { __dom_id: "b", value: 2 } },
      { op: "upsert", path: "/rows/-", value: { __dom_id: "a", value: 3 } },
      { op: "limit", path: "/rows", value: -1 },
    ]);

    expect(result.rows).toEqual([{ __dom_id: "b", value: 2 }]);
    expect(original.rows).toEqual([first]);
  });

  it("treats missing stream delete and update_only targets as idempotent", () => {
    const original = { rows: [{ __dom_id: "a", value: 1 }] };

    expect(
      applyPatch(original, [{ op: "remove", path: "/rows/$$missing" }]),
    ).toBe(original);
    expect(
      applyPatch(original, [
        {
          op: "replace",
          path: "/rows/$$missing",
          value: { __dom_id: "missing", value: 2 },
        },
      ]),
    ).toBe(original);
  });

  it("supports document-root replacement", () => {
    const replacement = { ready: true };
    expect(
      applyPatch({ ready: false }, [
        { op: "replace", path: "", value: replacement },
      ]),
    ).toBe(replacement);
  });

  it("handles escaped JSON Pointer property names", () => {
    const original = { "a/b~c": { value: "old" } };
    const result = applyPatch(original, [
      { op: "replace", path: "/a~1b~0c/value", value: "new" },
    ]);

    expect(result["a/b~c"]).toEqual({ value: "new" });
  });

  it("handles prototype-named properties without prototype pollution", () => {
    const original = { safe: true };
    const result = applyPatch(original, [
      { op: "add", path: "/__proto__", value: { local: true } },
      { op: "add", path: "/constructor", value: "local" },
    ]);
    const resultRecord = result as Record<string, unknown>;

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(resultRecord.__proto__).toEqual({ local: true });
    expect(resultRecord.constructor).toBe("local");
    expect(({} as Record<string, unknown>).local).toBeUndefined();
  });

  it.each([
    ["invalid pointer escape", "/items/~2", "replace"],
    ["non-canonical array index", "/items/01", "replace"],
    ["out-of-range replace", "/items/2", "replace"],
    ["out-of-range insert", "/items/3", "add"],
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
    ).toThrow("does not resolve to a value");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
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
