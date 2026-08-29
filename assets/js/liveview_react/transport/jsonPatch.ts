import type { PatchOperation, PatchOperationName } from "./compactPatch";

type JsonRecord = Record<string, unknown>;
type JsonContainer = JsonRecord | unknown[];
type ArrayIndexMode = "access" | "insert";

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isContainer(value: unknown): value is JsonContainer {
  return Array.isArray(value) || isRecord(value);
}

function cloneRecord(record: JsonRecord): JsonRecord {
  const clone: JsonRecord = {};
  for (const key of Object.keys(record)) {
    defineRecordValue(clone, key, record[key]);
  }
  return clone;
}

function cloneContainer(container: JsonContainer): JsonContainer {
  return Array.isArray(container) ? container.slice() : cloneRecord(container);
}

function defineRecordValue(
  record: JsonRecord,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function readRecordValue(
  record: JsonRecord,
  key: string,
  path: string,
): unknown {
  if (!Object.hasOwn(record, key)) {
    throw new Error(`JSON Patch path does not resolve to a value: ${path}`);
  }

  return record[key];
}

function parsePointer(path: string): readonly string[] {
  if (path === "") return Object.freeze([]);
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Patch path: ${path}`);
  }

  return Object.freeze(path.slice(1).split("/").map(unescapePathSegment));
}

function unescapePathSegment(segment: string): string {
  let decoded = "";

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]!;
    if (character !== "~") {
      decoded += character;
      continue;
    }

    const escaped = segment[++index];
    if (escaped === "0") decoded += "~";
    else if (escaped === "1") decoded += "/";
    else throw new Error(`Invalid JSON Pointer escape in segment: ${segment}`);
  }

  return decoded;
}

function domIdIndex(segment: string, array: readonly unknown[]): number | null {
  const targetId = segment.slice(2);
  const index = array.findIndex(
    (item) =>
      isRecord(item) &&
      Object.hasOwn(item, "__dom_id") &&
      item.__dom_id === targetId,
  );

  return index === -1 ? null : index;
}

function resolveArrayIndex(
  segment: string,
  array: readonly unknown[],
  mode: ArrayIndexMode,
): number {
  if (segment.startsWith("$$")) {
    const index = domIdIndex(segment, array);
    if (index === null) {
      throw new Error(
        `JSON Patch item with __dom_id "${segment.slice(2)}" was not found`,
      );
    }
    return index;
  }

  if (segment === "-") {
    if (mode === "insert") return array.length;
    throw new Error('JSON Patch "-" is only valid for array insert operations');
  }

  if (!/^(?:0|[1-9]\d*)$/.test(segment)) {
    throw new Error(`Invalid JSON Patch array index: ${segment}`);
  }

  const index = Number(segment);
  if (!Number.isSafeInteger(index)) {
    throw new Error(
      `JSON Patch array index exceeds the safe range: ${segment}`,
    );
  }

  const upperBound = mode === "insert" ? array.length : array.length - 1;
  if (index > upperBound) {
    throw new Error(`JSON Patch array index is out of bounds: ${segment}`);
  }

  return index;
}

function readChild(
  container: JsonContainer,
  segment: string,
  path: string,
): unknown {
  if (Array.isArray(container)) {
    return container[resolveArrayIndex(segment, container, "access")];
  }

  return readRecordValue(container, segment, path);
}

function setChild(
  container: JsonContainer,
  segment: string,
  value: unknown,
  path: string,
): void {
  if (Array.isArray(container)) {
    const index = resolveArrayIndex(segment, container, "access");
    container[index] = value;
    return;
  }

  if (!Object.hasOwn(container, segment)) {
    throw new Error(`JSON Patch path does not resolve to a value: ${path}`);
  }
  defineRecordValue(container, segment, value);
}

function ensureOwnedContainer(
  value: unknown,
  owned: WeakSet<object>,
  path: string,
): JsonContainer {
  if (!isContainer(value)) {
    throw new Error(`JSON Patch path does not resolve to a container: ${path}`);
  }

  if (owned.has(value)) return value;

  const clone = cloneContainer(value);
  owned.add(clone);
  return clone;
}

function ownPathToParent(
  document: JsonContainer,
  segments: readonly string[],
  owned: WeakSet<object>,
  path: string,
): JsonContainer {
  let target = document;

  for (const segment of segments.slice(0, -1)) {
    const child = readChild(target, segment, path);
    const ownedChild = ensureOwnedContainer(child, owned, path);
    if (ownedChild !== child) setChild(target, segment, ownedChild, path);
    target = ownedChild;
  }

  return target;
}

function requireFiniteNumber(operation: PatchOperationName, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`JSON Patch ${operation} requires a finite number`);
  }

  return value;
}

function applyLimit(target: unknown[], value: unknown): void {
  const limit = requireFiniteNumber("limit", value);

  if (limit >= 0) {
    if (limit < target.length) target.splice(limit);
    return;
  }

  const keepCount = Math.abs(limit);
  if (keepCount < target.length) {
    target.splice(0, target.length - keepCount);
  }
}

function applyRootOperation(
  document: unknown,
  operation: PatchOperation,
  owned: WeakSet<object>,
): unknown {
  switch (operation.op) {
    case "add":
    case "replace":
    case "upsert":
      return operation.value;
    case "remove":
      return null;
    case "limit": {
      const target = ensureOwnedContainer(document, owned, operation.path);
      if (!Array.isArray(target)) {
        throw new TypeError("A root limit operation requires an array");
      }
      applyLimit(target, operation.value);
      return target;
    }
  }
}

function applyArrayOperation(
  target: unknown[],
  segment: string,
  operation: PatchOperation,
): void {
  switch (operation.op) {
    case "add": {
      const index = resolveArrayIndex(segment, target, "insert");
      target.splice(index, 0, operation.value);
      return;
    }
    case "remove": {
      const index = resolveArrayIndex(segment, target, "access");
      target.splice(index, 1);
      return;
    }
    case "replace": {
      const index = resolveArrayIndex(segment, target, "access");
      target[index] = operation.value;
      return;
    }
    case "upsert": {
      const upsertValue = operation.value;
      if (isRecord(upsertValue) && Object.hasOwn(upsertValue, "__dom_id")) {
        const domId = upsertValue.__dom_id;
        const existingIndex = target.findIndex(
          (item) => isRecord(item) && item.__dom_id === domId,
        );
        if (existingIndex !== -1) {
          target[existingIndex] = upsertValue;
          return;
        }
      }

      const index = resolveArrayIndex(segment, target, "insert");
      target.splice(index, 0, operation.value);
      return;
    }
    case "limit":
      throw new TypeError("JSON Patch limit must target an array value");
  }
}

function applyRecordOperation(
  target: JsonRecord,
  segment: string,
  operation: PatchOperation,
): void {
  switch (operation.op) {
    case "add":
    case "upsert":
      defineRecordValue(target, segment, operation.value);
      return;
    case "replace":
      readRecordValue(target, segment, operation.path);
      defineRecordValue(target, segment, operation.value);
      return;
    case "remove":
      readRecordValue(target, segment, operation.path);
      delete target[segment];
      return;
    case "limit":
      throw new TypeError("JSON Patch limit must target an array value");
  }
}

function applyLimitAtPath(
  parent: JsonContainer,
  segment: string,
  operation: PatchOperation,
  owned: WeakSet<object>,
): void {
  const current = readChild(parent, segment, operation.path);
  const target = ensureOwnedContainer(current, owned, operation.path);
  if (!Array.isArray(target)) {
    throw new TypeError(
      `JSON Patch limit target is not an array: ${operation.path}`,
    );
  }

  if (target !== current) setChild(parent, segment, target, operation.path);
  applyLimit(target, operation.value);
}

function isOptionalMissingDomTarget(
  document: unknown,
  segments: readonly string[],
  operation: PatchOperationName,
  path: string,
): boolean {
  if (operation !== "remove" && operation !== "replace") return false;
  const finalSegment = segments.at(-1);
  if (!finalSegment?.startsWith("$$")) return false;

  let target = document;
  for (const segment of segments.slice(0, -1)) {
    if (!isContainer(target)) {
      throw new Error(
        `JSON Patch path does not resolve to a container: ${path}`,
      );
    }
    target = readChild(target, segment, path);
  }

  if (!Array.isArray(target)) {
    throw new Error(`JSON Patch path does not resolve to an array: ${path}`);
  }

  return domIdIndex(finalSegment, target) === null;
}

function applyNonRootOperation(
  document: unknown,
  segments: readonly string[],
  operation: PatchOperation,
  owned: WeakSet<object>,
): unknown {
  if (
    isOptionalMissingDomTarget(document, segments, operation.op, operation.path)
  ) {
    return document;
  }

  const root = ensureOwnedContainer(document, owned, operation.path);
  const parent = ownPathToParent(root, segments, owned, operation.path);
  const segment = segments.at(-1)!;

  if (operation.op === "limit") {
    applyLimitAtPath(parent, segment, operation, owned);
  } else if (Array.isArray(parent)) {
    applyArrayOperation(parent, segment, operation);
  } else {
    applyRecordOperation(parent, segment, operation);
  }

  return root;
}

export function applyPatch<T>(
  document: T,
  patch: readonly PatchOperation[],
): T {
  if (patch.length === 0) return document;

  const owned = new WeakSet<object>();
  let result: unknown = document;

  for (const operation of patch) {
    const segments = parsePointer(operation.path);
    result =
      segments.length === 0
        ? applyRootOperation(result, operation, owned)
        : applyNonRootOperation(result, segments, operation, owned);
  }

  return result as T;
}
