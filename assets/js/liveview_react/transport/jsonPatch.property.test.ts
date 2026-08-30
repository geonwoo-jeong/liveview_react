import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { PatchOperation } from "./compactPatch";
import { applyPatch } from "./jsonPatch";

type JsonScalar = null | boolean | number | string;
type JsonRecord = Readonly<Record<string, unknown>>;

const KEY_SENTINEL = "~/:^🚀한𝄞";
const KEY_FRAGMENTS = [
  "a",
  "Z",
  "0",
  ":",
  ".",
  "|",
  "~",
  "^",
  "/",
  "é",
  "한",
  "🚀",
  "𝄞",
] as const;

const jsonScalarArbitrary: fc.Arbitrary<JsonScalar> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
  fc
    .array(fc.constantFrom(...KEY_FRAGMENTS), { maxLength: 12 })
    .map((fragments) => `${fragments.join("")}${KEY_SENTINEL}`),
);

const propertyKeyArbitrary = fc
  .array(fc.constantFrom(...KEY_FRAGMENTS), { maxLength: 8 })
  .map((fragments) => `branch:${fragments.join("")}${KEY_SENTINEL}`);

const deepReplacementArbitrary = fc.record({
  segments: fc.array(propertyKeyArbitrary, { minLength: 1, maxLength: 5 }),
  before: jsonScalarArbitrary,
  replacements: fc.array(jsonScalarArbitrary, {
    minLength: 1,
    maxLength: 8,
  }),
});

const arrayReplacementArbitrary = fc.record({
  values: fc.array(jsonScalarArbitrary, { minLength: 1, maxLength: 14 }),
  updates: fc.array(
    fc.record({
      selector: fc.nat({ max: 10_000 }),
      replacement: jsonScalarArbitrary,
    }),
    { minLength: 1, maxLength: 10 },
  ),
});

const arrayEditArbitrary = fc.record({
  initial: fc.array(jsonScalarArbitrary, { maxLength: 12 }),
  commands: fc.array(
    fc.record({
      kind: fc.constantFrom<"add" | "remove" | "replace">(
        "add",
        "remove",
        "replace",
      ),
      selector: fc.nat({ max: 10_000 }),
      value: jsonScalarArbitrary,
    }),
    { minLength: 1, maxLength: 20 },
  ),
});

describe("JSON patch properties", () => {
  it("matches an immutable reference model for bounded deep replacements", () => {
    fc.assert(
      fc.property(
        deepReplacementArbitrary,
        ({ segments, before, replacements }) => {
          const original = buildNestedDocument(segments, before);
          const snapshot = cloneJson(original);
          const valuePath = [...segments, "value"];
          const path = pointerPath(valuePath);
          const patch = replacements.map((value) => ({
            op: "replace" as const,
            path,
            value,
          }));

          const result = applyPatch(original, patch);
          const expected = replacements.reduce(
            (document, replacement) =>
              replaceAtPath(document, valuePath, replacement),
            original as unknown,
          );

          expect(result).toEqual(expected);
          expect(original).toEqual(snapshot);
          expectChangedPathReferences(original, result, segments);
        },
      ),
      { seed: 1_370_452_190, numRuns: 180, endOnFailure: true },
    );
  });

  it("clones only the selected array path and preserves every other reference", () => {
    fc.assert(
      fc.property(arrayReplacementArbitrary, ({ values, updates }) => {
        const rows = values.map((value, index) => ({
          value,
          stable: { marker: `row-${index}` },
        }));
        const stableRoot = { marker: "root" };
        const original = { rows, stableRoot };
        const snapshot = cloneJson(original);
        const indexedUpdates = updates.map(({ selector, replacement }) => ({
          index: selector % rows.length,
          replacement,
        }));
        const patch = indexedUpdates.map(({ index, replacement }) => ({
          op: "replace" as const,
          path: `/rows/${index}/value`,
          value: replacement,
        }));

        const result = applyPatch(original, patch);
        const expectedRows = indexedUpdates.reduce(
          (currentRows, { index, replacement }) =>
            currentRows.map((row, rowIndex) =>
              rowIndex === index ? { ...row, value: replacement } : row,
            ),
          rows,
        );
        const changedIndexes = new Set(
          indexedUpdates.map(({ index }) => index),
        );

        expect(result).toEqual({ rows: expectedRows, stableRoot });
        expect(original).toEqual(snapshot);
        expect(result).not.toBe(original);
        expect(result.rows).not.toBe(rows);
        expect(result.stableRoot).toBe(stableRoot);

        for (const rowIndex of rows.keys()) {
          if (changedIndexes.has(rowIndex)) {
            expect(result.rows[rowIndex]).not.toBe(rows[rowIndex]);
            expect(result.rows[rowIndex]?.stable).toBe(rows[rowIndex]?.stable);
          } else {
            expect(result.rows[rowIndex]).toBe(rows[rowIndex]);
          }
        }
      }),
      { seed: 1_384_760_542, numRuns: 180, endOnFailure: true },
    );
  });

  it("matches an immutable reference model for bounded array edits", () => {
    fc.assert(
      fc.property(arrayEditArbitrary, ({ initial, commands }) => {
        const original = { items: initial, stable: { marker: "stable" } };
        const snapshot = cloneJson(original);
        const { expected, patch } = commands.reduce(
          (state, command) => applyReferenceCommand(state, command),
          {
            expected: initial as readonly JsonScalar[],
            patch: [] as readonly PatchOperation[],
          },
        );

        const result = applyPatch(original, patch);

        expect(result.items).toEqual(expected);
        expect(result.stable).toBe(original.stable);
        expect(original).toEqual(snapshot);
      }),
      { seed: 1_431_529_045, numRuns: 180, endOnFailure: true },
    );
  });
});

interface ArrayEditCommand {
  readonly kind: "add" | "remove" | "replace";
  readonly selector: number;
  readonly value: JsonScalar;
}

interface ArrayEditState {
  readonly expected: readonly JsonScalar[];
  readonly patch: readonly PatchOperation[];
}

function applyReferenceCommand(
  state: ArrayEditState,
  command: ArrayEditCommand,
): ArrayEditState {
  if (command.kind === "add" || state.expected.length === 0) {
    const index = command.selector % (state.expected.length + 1);
    return {
      expected: [
        ...state.expected.slice(0, index),
        command.value,
        ...state.expected.slice(index),
      ],
      patch: [
        ...state.patch,
        { op: "add", path: `/items/${index}`, value: command.value },
      ],
    };
  }

  const index = command.selector % state.expected.length;
  if (command.kind === "remove") {
    return {
      expected: [
        ...state.expected.slice(0, index),
        ...state.expected.slice(index + 1),
      ],
      patch: [...state.patch, { op: "remove", path: `/items/${index}` }],
    };
  }

  return {
    expected: state.expected.map((value, valueIndex) =>
      valueIndex === index ? command.value : value,
    ),
    patch: [
      ...state.patch,
      { op: "replace", path: `/items/${index}`, value: command.value },
    ],
  };
}

function buildNestedDocument(
  segments: readonly string[],
  before: JsonScalar,
): JsonRecord {
  let node: JsonRecord = {
    value: before,
    stableLeaf: { marker: "leaf" },
  };

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    node = {
      [segments[index]!]: node,
      [siblingKey(index)]: { marker: `level-${index}` },
    };
  }

  return node;
}

function replaceAtPath(
  value: unknown,
  segments: readonly string[],
  replacement: JsonScalar,
): unknown {
  if (segments.length === 0) return replacement;

  const record = value as JsonRecord;
  const [segment, ...rest] = segments;
  return {
    ...record,
    [segment!]: replaceAtPath(record[segment!], rest, replacement),
  };
}

function expectChangedPathReferences(
  original: JsonRecord,
  result: JsonRecord,
  segments: readonly string[],
): void {
  let originalNode = original;
  let resultNode = result;

  for (const [index, segment] of segments.entries()) {
    expect(resultNode).not.toBe(originalNode);
    expect(resultNode[siblingKey(index)]).toBe(originalNode[siblingKey(index)]);
    originalNode = originalNode[segment] as JsonRecord;
    resultNode = resultNode[segment] as JsonRecord;
  }

  expect(resultNode).not.toBe(originalNode);
  expect(resultNode.stableLeaf).toBe(originalNode.stableLeaf);
}

function pointerPath(segments: readonly string[]): string {
  return `/${segments.map(escapePointerSegment).join("/")}`;
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function siblingKey(index: number): string {
  return `stable-sibling-${index}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
