import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decodeCompactPatch, type PatchOperation } from "./compactPatch";

type JsonScalar = null | boolean | number | string;
type JsonValue =
  | JsonScalar
  | readonly JsonScalar[]
  | Readonly<Record<string, JsonScalar>>
  | readonly Readonly<Record<string, JsonScalar>>[]
  | Readonly<Record<string, readonly JsonScalar[]>>;

const TRANSPORT_SENTINEL = "~^:/|.🚀한𝄞";
const STRING_FRAGMENTS = [
  "a",
  "Z",
  "0",
  ":",
  ".",
  "|",
  "~",
  "^",
  "/",
  "\\",
  '"',
  "é",
  "한",
  "🚀",
  "𝄞",
] as const;

const transportStringArbitrary = fc
  .array(fc.constantFrom(...STRING_FRAGMENTS), { maxLength: 14 })
  .map((fragments) => `${fragments.join("")}${TRANSPORT_SENTINEL}`);

const pointerPathArbitrary = fc
  .array(transportStringArbitrary, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${segments.map(escapePointerSegment).join("/")}`);

const jsonScalarArbitrary: fc.Arbitrary<JsonScalar> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
  transportStringArbitrary,
);

const jsonValueArbitrary: fc.Arbitrary<JsonValue> = fc.oneof(
  jsonScalarArbitrary,
  fc.array(jsonScalarArbitrary, { maxLength: 6 }),
  fc.dictionary(transportStringArbitrary, jsonScalarArbitrary, {
    maxKeys: 6,
  }),
  fc.array(
    fc.dictionary(transportStringArbitrary, jsonScalarArbitrary, {
      maxKeys: 4,
    }),
    { maxLength: 4 },
  ),
  fc.dictionary(
    transportStringArbitrary,
    fc.array(jsonScalarArbitrary, { maxLength: 4 }),
    { maxKeys: 4 },
  ),
);

const valueOperationArbitrary: fc.Arbitrary<PatchOperation> = fc
  .tuple(
    fc.constantFrom<"add" | "replace" | "stream">("add", "replace", "stream"),
    pointerPathArbitrary,
    jsonValueArbitrary,
  )
  .map(([op, path, value]) => ({ op, path, value }));

const removeOperationArbitrary: fc.Arbitrary<PatchOperation> =
  pointerPathArbitrary.map((path) => ({ op: "remove", path }));

const patchArbitrary = fc.array(
  fc.oneof(valueOperationArbitrary, removeOperationArbitrary),
  { minLength: 1, maxLength: 18 },
);

describe("compact patch properties", () => {
  it("decodes bounded valid payloads without losing UTF-16 lengths or delimiters", () => {
    fc.assert(
      fc.property(patchArbitrary, (patch) => {
        const decoded = decodeCompactPatch(encodePatch(patch));

        expect(decoded).toEqual(patch);
        expect(Object.isFrozen(decoded)).toBe(true);
        expect(decoded.every(Object.isFrozen)).toBe(true);
      }),
      { seed: 1_592_638_686, numRuns: 180, endOnFailure: true },
    );
  });
});

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function encodePatch(patch: readonly PatchOperation[]): string {
  return patch.map(encodeOperation).join("");
}

function encodeOperation(operation: PatchOperation): string {
  const code = {
    add: "a",
    remove: "d",
    replace: "r",
    stream: "s",
  }[operation.op];
  const path = `${operation.path.length}:${operation.path}`;

  return operation.op === "remove"
    ? `${code}${path}`
    : `${code}${path}${encodeValue(operation.value as JsonValue)}`;
}

function encodeValue(value: JsonValue): string {
  if (value === null) return "z";
  if (value === true) return "b1";
  if (value === false) return "b0";

  if (typeof value === "number") {
    const encoded = String(value);
    return `n${encoded.length}:${encoded}`;
  }

  if (typeof value === "string") return `s${value.length}:${value}`;

  const encoded = JSON.stringify(value)
    .replaceAll("~", "~~")
    .replaceAll("^", "~^")
    .replaceAll('"', "^");

  return `J${encoded.length}:${encoded}`;
}
