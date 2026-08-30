import type { PatchOperation } from "./compactPatch";
import {
  assertSafePropertyName,
  dataPropertyMap,
  defineDataProperty,
  enumerableDataEntries,
  normalizeJsonArray,
} from "./jsonData";
import { normalizeStreamMap } from "./streamData";
import type { StreamItem, StreamMap } from "../types";

export type StreamPatchMode = "incremental" | "snapshot";

interface StreamInsert {
  readonly at: number;
  readonly domId: string;
  readonly limit: number | null;
  readonly updateOnly: boolean;
}

interface StreamFrame {
  readonly deletes: readonly string[];
  readonly inserts: ReadonlyMap<string, StreamInsert>;
  readonly items: readonly StreamItem[];
  readonly reset: boolean;
}

interface NamedStreamFrame {
  readonly frame: StreamFrame;
  readonly name: string;
}

const OPERATION_FIELDS = Object.freeze(["op", "path", "value"] as const);
const OPERATION_FIELD_SET: ReadonlySet<string> = new Set(OPERATION_FIELDS);
const FRAME_FIELDS = Object.freeze([
  "items",
  "inserts",
  "deletes",
  "reset",
] as const);
const FRAME_FIELD_SET: ReadonlySet<string> = new Set(FRAME_FIELDS);

function assertExactFields(
  fields: ReadonlyMap<string, unknown>,
  expected: readonly string[],
  expectedSet: ReadonlySet<string>,
  source: string,
): void {
  const unknown = [...fields.keys()].find((key) => !expectedSet.has(key));
  if (unknown !== undefined) {
    throw new TypeError(
      `${source} has unknown field ${JSON.stringify(unknown)}`,
    );
  }

  const missing = expected.find((key) => !fields.has(key));
  if (missing !== undefined) {
    throw new TypeError(`${source} requires field ${JSON.stringify(missing)}`);
  }
}

function decodePointerSegment(path: string, source: string): string {
  if (!path.startsWith("/") || path.length === 1) {
    throw new TypeError(
      `${source} path must identify one non-empty stream name`,
    );
  }

  const encoded = path.slice(1);
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index]!;
    if (character === "/") {
      throw new TypeError(`${source} path must contain exactly one segment`);
    }
    if (character !== "~") {
      decoded += character;
      continue;
    }

    const escaped = encoded[++index];
    if (escaped === "0") decoded += "~";
    else if (escaped === "1") decoded += "/";
    else
      throw new TypeError(`${source} path has an invalid JSON Pointer escape`);
  }

  if (decoded.length === 0) {
    throw new TypeError(
      `${source} path must identify one non-empty stream name`,
    );
  }
  assertSafePropertyName(decoded, `${source} path`);
  return decoded;
}

function requireDenseJsonArray(value: unknown, source: string) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${source} must be an array`);
  }
  return normalizeJsonArray(value, source, new Set());
}

function requireDomId(value: unknown, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${source} must be a non-empty string`);
  }
  return value;
}

function requirePosition(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -1) {
    throw new TypeError(`${source} must be -1 or a non-negative safe integer`);
  }
  return value;
}

function requireLimit(value: unknown, source: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${source} must be null or a safe integer`);
  }
  return value;
}

function normalizeItems(
  value: unknown,
  streamName: string,
  source: string,
): readonly StreamItem[] {
  const streamMap: Record<string, unknown> = Object.create(null);
  defineDataProperty(streamMap, streamName, value);
  return normalizeStreamMap(streamMap, source)[streamName]!;
}

function normalizeInserts(
  value: unknown,
  source: string,
): ReadonlyMap<string, StreamInsert> {
  const rawInserts = requireDenseJsonArray(value, source);
  const inserts = new Map<string, StreamInsert>();

  rawInserts.forEach((rawInsert, index) => {
    const insertSource = `${source}[${index}]`;
    const tuple = requireDenseJsonArray(rawInsert, insertSource);
    if (tuple.length !== 4) {
      throw new TypeError(`${insertSource} must contain exactly four values`);
    }

    const domId = requireDomId(tuple[0], `${insertSource}[0]`);
    const at = requirePosition(tuple[1], `${insertSource}[1]`);
    const limit = requireLimit(tuple[2], `${insertSource}[2]`);
    const updateOnly = tuple[3];
    if (typeof updateOnly !== "boolean") {
      throw new TypeError(`${insertSource}[3] must be a boolean`);
    }

    // Phoenix registers raw inserts in list order. LiveStream stores newest
    // inserts first, so an older duplicate is intentionally the final metadata
    // entry while the separately materialized item keeps the newest payload.
    inserts.set(domId, Object.freeze({ at, domId, limit, updateOnly }));
  });

  return inserts;
}

function normalizeDeletes(value: unknown, source: string): readonly string[] {
  return Object.freeze(
    requireDenseJsonArray(value, source).map((domId, index) =>
      requireDomId(domId, `${source}[${index}]`),
    ),
  );
}

function assertMatchingInsertIds(
  items: readonly StreamItem[],
  inserts: ReadonlyMap<string, StreamInsert>,
  source: string,
): void {
  const itemIds = new Set(items.map((item) => item.__dom_id));
  const missingMetadata = [...itemIds].find((domId) => !inserts.has(domId));
  if (missingMetadata !== undefined) {
    throw new TypeError(
      `${source} item ${JSON.stringify(missingMetadata)} has no insert metadata`,
    );
  }

  const missingItem = [...inserts.keys()].find((domId) => !itemIds.has(domId));
  if (missingItem !== undefined) {
    throw new TypeError(
      `${source} insert ${JSON.stringify(missingItem)} has no materialized item`,
    );
  }
}

function normalizeFrame(
  value: unknown,
  streamName: string,
  source: string,
): StreamFrame {
  const fields = dataPropertyMap(value, source);
  assertExactFields(fields, FRAME_FIELDS, FRAME_FIELD_SET, source);

  const items = normalizeItems(
    fields.get("items"),
    streamName,
    `${source}.items`,
  );
  const inserts = normalizeInserts(fields.get("inserts"), `${source}.inserts`);
  const deletes = normalizeDeletes(fields.get("deletes"), `${source}.deletes`);
  const reset = fields.get("reset");
  if (typeof reset !== "boolean") {
    throw new TypeError(`${source}.reset must be a boolean`);
  }
  assertMatchingInsertIds(items, inserts, source);

  return Object.freeze({ deletes, inserts, items, reset });
}

function normalizeOperation(
  operation: PatchOperation,
  index: number,
): NamedStreamFrame {
  const source = `stream patch operation[${index}]`;
  const fields = dataPropertyMap(operation, source);
  assertExactFields(fields, OPERATION_FIELDS, OPERATION_FIELD_SET, source);
  if (fields.get("op") !== "stream") {
    throw new TypeError(`${source} must use the "stream" operation`);
  }

  const path = fields.get("path");
  if (typeof path !== "string") {
    throw new TypeError(`${source}.path must be a string`);
  }
  const name = decodePointerSegment(path, source);
  return Object.freeze({
    frame: normalizeFrame(fields.get("value"), name, `${source}.value`),
    name,
  });
}

function effectivePosition(at: number, length: number): number {
  return at === -1 ? length : Math.min(at, length);
}

function applyLimit(items: StreamItem[], limit: number | null): boolean {
  if (limit === null) return false;
  if (limit >= 0) {
    if (items.length <= limit) return false;
    items.splice(limit);
    return true;
  }

  const keep = Math.abs(limit);
  if (items.length <= keep) return false;
  items.splice(0, items.length - keep);
  return true;
}

function indexStreamItems(items: readonly StreamItem[]): Map<string, number> {
  return new Map(items.map((item, index) => [item.__dom_id, index]));
}

function sameItemReferences(
  left: readonly StreamItem[],
  right: readonly StreamItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function reconcileStream(
  current: readonly StreamItem[],
  frame: StreamFrame,
  mode: StreamPatchMode,
): readonly StreamItem[] {
  const priorById = new Map(current.map((item) => [item.__dom_id, item]));
  const deleteIds = new Set(frame.deletes);
  const startsEmpty = mode === "snapshot" || frame.reset;
  const next: StreamItem[] = startsEmpty
    ? []
    : current.filter((item) => !deleteIds.has(item.__dom_id));
  let indexById = indexStreamItems(next);

  for (const item of frame.items) {
    const metadata = frame.inserts.get(item.__dom_id)!;
    const existingIndex = indexById.get(item.__dom_id);

    if (existingIndex !== undefined) {
      // Phoenix updates an existing, non-reset stream child in place. `at` and
      // `limit` are insert semantics and therefore do not run on this branch.
      next[existingIndex] = item;
      continue;
    }

    if (metadata.updateOnly && !priorById.has(item.__dom_id)) {
      continue;
    }

    const insertionIndex = effectivePosition(metadata.at, next.length);
    const appended = insertionIndex === next.length;
    next.splice(insertionIndex, 0, item);
    if (appended) {
      indexById.set(item.__dom_id, insertionIndex);
    } else {
      for (let index = insertionIndex; index < next.length; index += 1) {
        indexById.set(next[index]!.__dom_id, index);
      }
    }
    if (applyLimit(next, metadata.limit)) {
      indexById = indexStreamItems(next);
    }
  }

  if (mode === "incremental" && sameItemReferences(current, next)) {
    return current;
  }
  return Object.freeze(next);
}

function normalizeCurrentStreams(
  current: StreamMap,
): readonly (readonly [string, readonly StreamItem[]])[] {
  return enumerableDataEntries(current, "current streams").map(
    ([name, items]) => {
      assertSafePropertyName(name, "current streams");
      if (!Array.isArray(items)) {
        throw new TypeError(`current streams.${name} must be an array`);
      }
      return Object.freeze([name, items as readonly StreamItem[]] as const);
    },
  );
}

/**
 * Applies Phoenix stream frames against immutable React stream props.
 *
 * Snapshot mode models LiveView join/rejoin: prior items are available for
 * `update_only` restoration, but membership is rebuilt only from the incoming
 * frame. Incremental mode retains untouched streams and updates existing items
 * in place without reapplying insertion limits.
 */
export function applyStreamPatch(
  current: StreamMap,
  operations: readonly PatchOperation[],
  mode: StreamPatchMode,
): StreamMap {
  if (mode !== "incremental" && mode !== "snapshot") {
    throw new TypeError(`Unknown stream patch mode: ${String(mode)}`);
  }

  const frames = operations.map(normalizeOperation);
  const seenNames = new Set<string>();
  for (const { name } of frames) {
    if (seenNames.has(name)) {
      throw new TypeError(
        `stream patch contains duplicate stream ${JSON.stringify(name)}`,
      );
    }
    seenNames.add(name);
  }

  const currentEntries = normalizeCurrentStreams(current);
  const currentByName = new Map(currentEntries);
  if (mode === "incremental" && frames.length === 0) return current;

  const reconciled = new Map<string, readonly StreamItem[]>();
  let changed = mode === "snapshot";
  for (const { frame, name } of frames) {
    const hadCurrentStream = currentByName.has(name);
    const currentItems = currentByName.get(name) ?? Object.freeze([]);
    const nextItems = reconcileStream(currentItems, frame, mode);
    if (!hadCurrentStream || nextItems !== currentItems) changed = true;
    reconciled.set(name, nextItems);
  }

  if (!changed && mode === "incremental") return current;

  const result: Record<string, readonly StreamItem[]> = Object.create(null);
  if (mode === "incremental") {
    for (const [name, items] of currentEntries) {
      defineDataProperty(result, name, reconciled.get(name) ?? items);
    }
  }
  for (const { name } of frames) {
    if (!Object.hasOwn(result, name)) {
      defineDataProperty(result, name, reconciled.get(name)!);
    }
  }
  return Object.freeze(result);
}
