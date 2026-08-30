import { describe, expect, it } from "vitest";

import type { PatchOperation } from "./compactPatch";
import { normalizeStreamMap } from "./streamData";
import { applyStreamPatch } from "./streamPatch";

function item(domId: string, label = domId) {
  return { __dom_id: domId, label };
}

function streams(value: unknown) {
  return normalizeStreamMap(value, "test streams");
}

function frame(
  name: string,
  items: readonly Readonly<Record<string, unknown>>[],
  inserts: readonly (readonly [string, number, number | null, boolean])[],
  deletes: readonly string[] = [],
  reset = false,
): PatchOperation {
  const path = `/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  return {
    op: "stream",
    path,
    value: { deletes, inserts, items, reset },
  };
}

describe("applyStreamPatch", () => {
  it("keeps ordinary existing updates in place without reapplying at or limit", () => {
    const current = streams({
      users: [item("one"), item("two"), item("three"), item("four")],
    });

    const next = applyStreamPatch(
      current,
      [
        frame(
          "users",
          [item("two", "Two ordinary updated")],
          [["two", 0, 2, false]],
        ),
      ],
      "incremental",
    );

    expect(next.users).toEqual([
      item("one"),
      item("two", "Two ordinary updated"),
      item("three"),
      item("four"),
    ]);
  });

  it("keeps update_only existing updates in place without applying a limit", () => {
    const current = streams({
      users: [item("one"), item("two"), item("three"), item("four")],
    });

    const next = applyStreamPatch(
      current,
      [frame("users", [item("two", "updated")], [["two", 0, 2, true]])],
      "incremental",
    );

    expect(next.users).toEqual([
      item("one"),
      item("two", "updated"),
      item("three"),
      item("four"),
    ]);
  });

  it("skips a missing update_only item and its limit without changing references", () => {
    const current = streams({
      notifications: [item("notice")],
      users: [item("one"), item("two"), item("three"), item("four")],
    });

    const next = applyStreamPatch(
      current,
      [frame("users", [item("missing")], [["missing", 0, 2, true]])],
      "incremental",
    );

    expect(next).toBe(current);
    expect(next.users).toBe(current.users);
    expect(next.notifications).toBe(current.notifications);
  });

  it("restores an update_only item across reset and drops unmentioned items", () => {
    const current = streams({
      users: [item("one"), item("two"), item("three"), item("four")],
    });

    const next = applyStreamPatch(
      current,
      [frame("users", [item("two", "reset")], [["two", 0, 2, true]], [], true)],
      "incremental",
    );

    expect(next.users).toEqual([item("two", "reset")]);
  });

  it("restores a deleted incoming item and applies insertion position and limit", () => {
    const current = streams({
      users: [item("one"), item("two"), item("three")],
    });

    const next = applyStreamPatch(
      current,
      [
        frame(
          "users",
          [item("two", "restored")],
          [["two", 0, -2, true]],
          ["two"],
        ),
      ],
      "incremental",
    );

    expect(next.users).toEqual([item("one"), item("three")]);
  });

  it("rebuilds snapshots from incoming membership while consulting prior presence", () => {
    const current = streams({
      stale: [item("stale")],
      users: [item("one"), item("two")],
    });

    const next = applyStreamPatch(
      current,
      [
        frame(
          "users",
          [item("two", "joined"), item("new", "ignored")],
          [
            ["new", -1, null, true],
            ["two", -1, null, true],
          ],
        ),
      ],
      "snapshot",
    );

    expect(next).toEqual({ users: [item("two", "joined")] });
    expect(next).not.toHaveProperty("stale");
  });

  it("uses Phoenix raw-order duplicate metadata with the newest materialized payload", () => {
    const next = applyStreamPatch(
      streams({}),
      [
        frame(
          "users",
          [item("one", "newest payload"), item("two")],
          [
            ["one", 0, null, true],
            ["two", -1, null, false],
            ["one", -1, null, false],
          ],
        ),
      ],
      "snapshot",
    );

    expect(next.users).toEqual([item("one", "newest payload"), item("two")]);
  });

  it("applies each accepted new insert's signed limit immediately", () => {
    const next = applyStreamPatch(
      streams({ users: [item("zero")] }),
      [
        frame(
          "users",
          [item("one"), item("two"), item("three")],
          [
            ["three", 0, -2, false],
            ["two", 0, null, false],
            ["one", -1, 3, false],
          ],
        ),
      ],
      "incremental",
    );

    expect(next.users).toEqual([item("zero"), item("one")]);
  });

  it("preserves untouched stream and item references while freezing changed data", () => {
    const current = streams({
      notifications: [item("notice")],
      users: [item("one", "before"), item("two")],
    });

    const next = applyStreamPatch(
      current,
      [frame("users", [item("one", "after")], [["one", -1, null, false]])],
      "incremental",
    );

    expect(next).not.toBe(current);
    expect(next.notifications).toBe(current.notifications);
    expect(next.users).not.toBe(current.users);
    expect(next.users![0]).not.toBe(current.users![0]);
    expect(next.users![1]).toBe(current.users![1]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.users)).toBe(true);
    expect(Object.isFrozen(next.users![0])).toBe(true);
  });

  it("drops all streams for an empty snapshot and preserves an empty incremental frame", () => {
    const current = streams({ users: [item("one")] });

    expect(applyStreamPatch(current, [], "incremental")).toBe(current);
    expect(applyStreamPatch(current, [], "snapshot")).toEqual({});
    expect(
      applyStreamPatch(current, [frame("empty", [], [])], "incremental"),
    ).toEqual({ empty: [], users: [item("one")] });
  });

  it("accepts one escaped stream-name segment", () => {
    const next = applyStreamPatch(
      streams({}),
      [frame("admin/users~active", [item("one")], [["one", -1, null, false]])],
      "snapshot",
    );

    expect(next["admin/users~active"]).toEqual([item("one")]);
  });

  it.each([
    [
      "a generic operation",
      { op: "add", path: "/users", value: {} },
      "must use",
    ],
    ["a root path", { op: "stream", path: "", value: {} }, "one non-empty"],
    [
      "two path segments",
      { op: "stream", path: "/users/items", value: {} },
      "exactly one",
    ],
    [
      "an unsafe path",
      { op: "stream", path: "/__proto__", value: {} },
      "prototype-sensitive",
    ],
    [
      "a bad escape",
      { op: "stream", path: "/users~2", value: {} },
      "invalid JSON Pointer",
    ],
    [
      "an extra frame field",
      {
        op: "stream",
        path: "/users",
        value: {
          deletes: [],
          extra: true,
          inserts: [],
          items: [],
          reset: false,
        },
      },
      "unknown field",
    ],
    [
      "a missing frame field",
      {
        op: "stream",
        path: "/users",
        value: { deletes: [], inserts: [], items: [] },
      },
      "requires field",
    ],
    [
      "mismatched item metadata",
      {
        op: "stream",
        path: "/users",
        value: {
          deletes: [],
          inserts: [["two", -1, null, false]],
          items: [item("one")],
          reset: false,
        },
      },
      "has no insert metadata",
    ],
    [
      "an invalid position",
      {
        op: "stream",
        path: "/users",
        value: {
          deletes: [],
          inserts: [["one", -2, null, false]],
          items: [item("one")],
          reset: false,
        },
      },
      "must be -1",
    ],
    [
      "an invalid limit",
      {
        op: "stream",
        path: "/users",
        value: {
          deletes: [],
          inserts: [["one", -1, 1.5, false]],
          items: [item("one")],
          reset: false,
        },
      },
      "safe integer",
    ],
    [
      "an invalid update_only flag",
      {
        op: "stream",
        path: "/users",
        value: {
          deletes: [],
          inserts: [["one", -1, null, null]],
          items: [item("one")],
          reset: false,
        },
      },
      "must be a boolean",
    ],
  ])("rejects %s", (_label, operation, message) => {
    expect(() =>
      applyStreamPatch(streams({}), [operation as PatchOperation], "snapshot"),
    ).toThrow(message);
  });

  it("rejects duplicate stream operations atomically", () => {
    const operation = frame("users", [], []);
    expect(() =>
      applyStreamPatch(streams({}), [operation, operation], "snapshot"),
    ).toThrow("duplicate stream");
  });

  it("rejects accessors, symbols, sparse arrays, and extended arrays", () => {
    const accessorFrame = Object.defineProperty({}, "items", {
      enumerable: true,
      get: () => [],
    });
    Object.assign(accessorFrame, { deletes: [], inserts: [], reset: false });

    const symbolFrame = {
      deletes: [],
      inserts: [],
      items: [],
      reset: false,
      [Symbol("extra")]: true,
    };
    const sparseItems = Array(1);
    const extendedDeletes: unknown[] = [];
    Object.defineProperty(extendedDeletes, "extra", {
      enumerable: true,
      value: true,
    });

    for (const value of [
      accessorFrame,
      symbolFrame,
      { deletes: [], inserts: [], items: sparseItems, reset: false },
      { deletes: extendedDeletes, inserts: [], items: [], reset: false },
    ]) {
      expect(() =>
        applyStreamPatch(
          streams({}),
          [{ op: "stream", path: "/users", value }],
          "snapshot",
        ),
      ).toThrow();
    }
  });
});
