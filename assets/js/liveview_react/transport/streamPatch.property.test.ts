import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { StreamItem, StreamMap } from "../types";
import type { PatchOperation } from "./compactPatch";
import { applyStreamPatch, type StreamPatchMode } from "./streamPatch";

interface InsertMetadata {
  readonly at: number;
  readonly limit: number | null;
  readonly updateOnly: boolean;
}

type InsertTuple = readonly [string, number, number | null, boolean];

interface StreamFrameInput {
  readonly deletes: readonly string[];
  readonly inserts: readonly InsertTuple[];
  readonly items: readonly StreamItem[];
  readonly reset: boolean;
}

interface GeneratedScenario {
  readonly currentIds: readonly string[];
  readonly frame: StreamFrameInput;
  readonly mode: StreamPatchMode;
}

const ID_ARBITRARY = fc.integer({ min: 0, max: 7 });
const AT_ARBITRARY = fc.oneof(fc.constant(-1), fc.integer({ min: 0, max: 7 }));
const LIMIT_ARBITRARY = fc.oneof(
  fc.constant(null),
  fc.integer({ min: -5, max: 5 }),
);
const METADATA_ARBITRARY: fc.Arbitrary<InsertMetadata> = fc.record({
  at: AT_ARBITRARY,
  limit: LIMIT_ARBITRARY,
  updateOnly: fc.boolean(),
});

const GENERAL_SCENARIO_ARBITRARY: fc.Arbitrary<GeneratedScenario> = fc
  .record({
    currentSelectors: fc.uniqueArray(ID_ARBITRARY, { maxLength: 6 }),
    deleteSelectors: fc.uniqueArray(ID_ARBITRARY, { maxLength: 6 }),
    incomingSelectors: fc.uniqueArray(ID_ARBITRARY, { maxLength: 6 }),
    mode: fc.constantFrom<StreamPatchMode>("incremental", "snapshot"),
    reset: fc.boolean(),
  })
  .chain((base) =>
    fc
      .tuple(
        fc.array(fc.array(METADATA_ARBITRARY, { minLength: 2, maxLength: 3 }), {
          minLength: base.incomingSelectors.length,
          maxLength: base.incomingSelectors.length,
        }),
        fc.array(fc.integer({ min: -100, max: 100 }), {
          minLength: base.incomingSelectors.length,
          maxLength: base.incomingSelectors.length,
        }),
      )
      .map(([metadataHistories, revisions]) => {
        const incomingIds = base.incomingSelectors.map(idFromSelector);
        const items = incomingIds.map((domId, index) =>
          item(domId, `incoming-${revisions[index]}`),
        );
        const inserts = incomingIds.flatMap((domId, index) =>
          metadataHistories[index]!.map(
            ({ at, limit, updateOnly }): InsertTuple => [
              domId,
              at,
              limit,
              updateOnly,
            ],
          ),
        );

        return {
          currentIds: base.currentSelectors.map(idFromSelector),
          frame: {
            deletes: base.deleteSelectors.map(idFromSelector),
            inserts,
            items,
            reset: base.reset,
          },
          mode: base.mode,
        };
      }),
  );

describe("stream patch properties", () => {
  it("matches an independent Phoenix oracle for bounded frames", () => {
    fc.assert(
      fc.property(GENERAL_SCENARIO_ARBITRARY, ({ currentIds, frame, mode }) => {
        const current = currentStreams(currentIds);
        const operation = streamOperation(frame);
        const currentBefore = cloneJson(current);
        const operationBefore = cloneJson(operation);

        const result = applyStreamPatch(current, [operation], mode);
        const expectedUsers = reconcileWithPhoenixOracle(
          current.users!,
          frame,
          mode,
        );
        const expected =
          mode === "snapshot"
            ? { users: expectedUsers }
            : { stable: current.stable, users: expectedUsers };

        expect(result).toEqual(expected);
        expect(current).toEqual(currentBefore);
        expect(operation).toEqual(operationBefore);
        expectUniqueFrozenStreams(result);
        expectCopyOnWrite(current, result, frame, mode);
      }),
      { seed: 1_897_331_904, numRuns: 240, endOnFailure: true },
    );
  });

  it("updates an existing item in place without applying at or limit", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(ID_ARBITRARY, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        AT_ARBITRARY,
        LIMIT_ARBITRARY,
        fc.boolean(),
        (selectors, targetSelector, at, limit, updateOnly) => {
          const current = currentStreams(selectors.map(idFromSelector));
          const targetIndex = targetSelector % current.users!.length;
          const targetId = current.users![targetIndex]!.__dom_id;
          const updated = item(targetId, "updated-existing");
          const frame: StreamFrameInput = {
            deletes: [],
            inserts: [[targetId, at, limit, updateOnly]],
            items: [updated],
            reset: false,
          };

          const result = applyStreamPatch(
            current,
            [streamOperation(frame)],
            "incremental",
          );

          expect(result.users).toEqual(
            current.users!.map((entry, index) =>
              index === targetIndex ? updated : entry,
            ),
          );
          expect(result.users).toHaveLength(current.users!.length);
          expectUniqueFrozenStreams(result);
        },
      ),
      { seed: 1_654_406_017, numRuns: 100, endOnFailure: true },
    );
  });

  it("skips an absent update_only item and its signed limit with full COW", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(ID_ARBITRARY, { maxLength: 6 }),
        AT_ARBITRARY,
        LIMIT_ARBITRARY,
        (selectors, at, limit) => {
          const current = currentStreams(selectors.map(idFromSelector));
          const missingId = "missing";
          const operation = streamOperation({
            deletes: [],
            inserts: [[missingId, at, limit, true]],
            items: [item(missingId, "must-not-mount")],
            reset: false,
          });
          const operationBefore = cloneJson(operation);

          const result = applyStreamPatch(current, [operation], "incremental");

          expect(result).toBe(current);
          expect(result.users).toBe(current.users);
          expect(result.stable).toBe(current.stable);
          expect(operation).toEqual(operationBefore);
          expectUniqueFrozenStreams(result);
        },
      ),
      { seed: 1_236_738_093, numRuns: 100, endOnFailure: true },
    );
  });

  it("restores a reset or deleted prior ID before applying position and limit", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(ID_ARBITRARY, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        AT_ARBITRARY,
        LIMIT_ARBITRARY,
        fc.boolean(),
        (selectors, targetSelector, at, limit, reset) => {
          const current = currentStreams(selectors.map(idFromSelector));
          const targetId =
            current.users![targetSelector % current.users!.length]!.__dom_id;
          const frame: StreamFrameInput = {
            deletes: reset ? [] : [targetId],
            inserts: [[targetId, at, limit, true]],
            items: [item(targetId, "restored")],
            reset,
          };

          const result = applyStreamPatch(
            current,
            [streamOperation(frame)],
            "incremental",
          );

          expect(result.users).toEqual(
            reconcileWithPhoenixOracle(current.users!, frame, "incremental"),
          );
          expectUniqueFrozenStreams(result);
        },
      ),
      { seed: 1_109_202_029, numRuns: 120, endOnFailure: true },
    );
  });

  it("rebuilds snapshot membership while consulting prior IDs for update_only", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(ID_ARBITRARY, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        (selectors, targetSelector) => {
          const current = currentStreams(selectors.map(idFromSelector));
          const priorId =
            current.users![targetSelector % current.users!.length]!.__dom_id;
          const missingId = "missing";
          const frame: StreamFrameInput = {
            deletes: [],
            inserts: [
              [priorId, -1, null, true],
              [missingId, -1, null, true],
            ],
            items: [
              item(priorId, "restored-on-join"),
              item(missingId, "ignored-on-join"),
            ],
            reset: false,
          };

          const result = applyStreamPatch(
            current,
            [streamOperation(frame)],
            "snapshot",
          );

          expect(result).toEqual({
            users: [item(priorId, "restored-on-join")],
          });
          expect(result).not.toHaveProperty("stable");
          expectUniqueFrozenStreams(result);
        },
      ),
      { seed: 1_693_030_067, numRuns: 100, endOnFailure: true },
    );
  });
});

function idFromSelector(selector: number): string {
  return `id-${selector}`;
}

function item(domId: string, value: string): StreamItem {
  return { __dom_id: domId, value };
}

function frozenItem(domId: string, value: string): StreamItem {
  return Object.freeze(item(domId, value));
}

function currentStreams(ids: readonly string[]): StreamMap {
  return Object.freeze({
    stable: Object.freeze([frozenItem("stable-0", "stable")]),
    users: Object.freeze(
      ids.map((domId) => frozenItem(domId, `current-${domId}`)),
    ),
  });
}

function streamOperation(frame: StreamFrameInput): PatchOperation {
  return { op: "stream", path: "/users", value: frame };
}

function reconcileWithPhoenixOracle(
  current: readonly StreamItem[],
  frame: StreamFrameInput,
  mode: StreamPatchMode,
): readonly StreamItem[] {
  const priorIds = new Set(current.map((entry) => entry.__dom_id));
  const deletedIds = new Set(frame.deletes);
  const effectiveMetadata = new Map<string, InsertMetadata>();
  for (const [domId, at, limit, updateOnly] of frame.inserts) {
    effectiveMetadata.set(domId, { at, limit, updateOnly });
  }

  let next =
    mode === "snapshot" || frame.reset
      ? ([] as readonly StreamItem[])
      : current.filter((entry) => !deletedIds.has(entry.__dom_id));

  for (const incoming of frame.items) {
    const metadata = effectiveMetadata.get(incoming.__dom_id)!;
    const existingIndex = next.findIndex(
      (entry) => entry.__dom_id === incoming.__dom_id,
    );

    if (existingIndex !== -1) {
      next = next.map((entry, index) =>
        index === existingIndex ? incoming : entry,
      );
      continue;
    }

    if (metadata.updateOnly && !priorIds.has(incoming.__dom_id)) {
      continue;
    }

    const insertionIndex =
      metadata.at === -1 ? next.length : Math.min(metadata.at, next.length);
    next = [
      ...next.slice(0, insertionIndex),
      incoming,
      ...next.slice(insertionIndex),
    ];
    next = applySignedLimit(next, metadata.limit);
  }

  return next;
}

function applySignedLimit(
  items: readonly StreamItem[],
  limit: number | null,
): readonly StreamItem[] {
  if (limit === null || items.length <= Math.abs(limit)) return items;
  if (limit >= 0) return items.slice(0, limit);
  return items.slice(items.length - Math.abs(limit));
}

function expectUniqueFrozenStreams(streams: StreamMap): void {
  expect(Object.isFrozen(streams)).toBe(true);
  for (const entries of Object.values(streams)) {
    expect(Object.isFrozen(entries)).toBe(true);
    const ids = entries.map((entry) => entry.__dom_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  }
}

function expectCopyOnWrite(
  current: StreamMap,
  result: StreamMap,
  frame: StreamFrameInput,
  mode: StreamPatchMode,
): void {
  if (mode === "snapshot") return;

  expect(result.stable).toBe(current.stable);
  const incomingIds = new Set(frame.items.map((entry) => entry.__dom_id));
  const currentById = new Map(
    current.users!.map((entry) => [entry.__dom_id, entry]),
  );
  for (const entry of result.users!) {
    if (currentById.has(entry.__dom_id) && !incomingIds.has(entry.__dom_id)) {
      expect(entry).toBe(currentById.get(entry.__dom_id));
    }
  }

  if (
    result.users!.length === current.users!.length &&
    result.users!.every((entry, index) => entry === current.users![index])
  ) {
    expect(result.users).toBe(current.users);
    expect(result).toBe(current);
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
