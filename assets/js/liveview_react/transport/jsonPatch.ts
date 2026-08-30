import type { PatchOperation, PatchOperationName } from "./compactPatch";

type JsonRecord = Record<string, unknown>;
type JsonContainer = JsonRecord | unknown[];
type ArrayIndexMode = "access" | "add";
type GenericPatchOperationName = Exclude<PatchOperationName, "stream">;
type GenericPatchOperation = PatchOperation & {
  readonly op: GenericPatchOperationName;
};

const PATCH_OPERATION_NAMES: ReadonlySet<string> = new Set([
  "add",
  "remove",
  "replace",
]);
const PATCH_OPERATION_FIELDS: ReadonlySet<string> = new Set([
  "op",
  "path",
  "value",
]);
const PROTOTYPE_SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

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

function cloneRecord(record: JsonRecord, path: string): JsonRecord {
  const clone = Object.create(Object.getPrototypeOf(record)) as JsonRecord;

  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      throw new TypeError(
        `JSON Patch document contains a symbol key at path: ${path}`,
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        `JSON Patch document must use enumerable data properties at path: ${path}`,
      );
    }

    defineRecordValue(clone, key, descriptor.value);
  }

  return clone;
}

function cloneArray(array: unknown[], path: string): unknown[] {
  const ownKeys = Reflect.ownKeys(array);
  if (
    ownKeys.length !== array.length + 1 ||
    ownKeys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)),
    )
  ) {
    throw new TypeError(
      `JSON Patch arrays must be dense and unextended at path: ${path}`,
    );
  }

  const clone = new Array<unknown>(array.length);
  for (let index = 0; index < array.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        `JSON Patch arrays must use enumerable data elements at path: ${path}`,
      );
    }
    clone[index] = descriptor.value;
  }

  return clone;
}

function cloneContainer(container: JsonContainer, path: string): JsonContainer {
  return Array.isArray(container)
    ? cloneArray(container, path)
    : cloneRecord(container, path);
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
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) {
    throw new Error(`JSON Patch path does not resolve to a value: ${path}`);
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(
      `JSON Patch document must use enumerable data properties at path: ${path}`,
    );
  }

  return descriptor.value;
}

function parsePointer(path: string): readonly string[] {
  if (path === "") return Object.freeze([]);
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Patch path: ${path}`);
  }

  const segments = path.slice(1).split("/").map(unescapePathSegment);
  const unsafeSegment = segments.find((segment) =>
    PROTOTYPE_SENSITIVE_SEGMENTS.has(segment),
  );
  if (unsafeSegment) {
    throw new Error(
      `JSON Patch path contains prototype-sensitive segment: ${unsafeSegment}`,
    );
  }

  return Object.freeze(segments);
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

function resolveArrayIndex(
  segment: string,
  array: readonly unknown[],
  mode: ArrayIndexMode,
): number {
  if (segment === "-") {
    if (mode === "add") return array.length;
    throw new Error('JSON Patch "-" is only valid for array add operations');
  }

  if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) {
    throw new Error(`Invalid JSON Patch array index: ${segment}`);
  }

  const index = Number(segment);
  if (!Number.isSafeInteger(index)) {
    throw new Error(
      `JSON Patch array index exceeds the safe range: ${segment}`,
    );
  }

  if (mode === "add") {
    if (index > array.length) {
      throw new Error(`JSON Patch array index is out of bounds: ${segment}`);
    }
    return index;
  }

  if (index >= array.length) {
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

  readRecordValue(container, segment, path);
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

  const clone = cloneContainer(value, path);
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

function applyRootOperation(operation: GenericPatchOperation): unknown {
  switch (operation.op) {
    case "add":
    case "replace":
      return operation.value;
    case "remove":
      return null;
  }
}

function applyArrayOperation(
  target: unknown[],
  segment: string,
  operation: GenericPatchOperation,
): void {
  switch (operation.op) {
    case "add": {
      const index = resolveArrayIndex(segment, target, "add");
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
    }
  }
}

function applyRecordOperation(
  target: JsonRecord,
  segment: string,
  operation: GenericPatchOperation,
): void {
  switch (operation.op) {
    case "add":
      defineRecordValue(target, segment, operation.value);
      return;
    case "replace":
      readRecordValue(target, segment, operation.path);
      defineRecordValue(target, segment, operation.value);
      return;
    case "remove":
      readRecordValue(target, segment, operation.path);
      delete target[segment];
  }
}

function applyNonRootOperation(
  document: unknown,
  segments: readonly string[],
  operation: GenericPatchOperation,
  owned: WeakSet<object>,
): unknown {
  const root = ensureOwnedContainer(document, owned, operation.path);
  const parent = ownPathToParent(root, segments, owned, operation.path);
  const segment = segments.at(-1)!;

  if (Array.isArray(parent)) {
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
  const operations = normalizePatch(patch);
  if (operations.length === 0) return document;

  const owned = new WeakSet<object>();
  let result: unknown = document;

  for (const operation of operations) {
    const segments = parsePointer(operation.path);
    result =
      segments.length === 0
        ? applyRootOperation(operation)
        : applyNonRootOperation(result, segments, operation, owned);
  }

  return result as T;
}

function normalizePatch(value: unknown): readonly GenericPatchOperation[] {
  if (!Array.isArray(value)) {
    throw new TypeError("JSON Patch document must be an array");
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)),
    )
  ) {
    throw new TypeError("JSON Patch operations must be dense and unextended");
  }

  const operations: GenericPatchOperation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("JSON Patch operations must use data elements");
    }
    operations.push(normalizePatchOperation(descriptor.value, index));
  }

  return Object.freeze(operations);
}

function normalizePatchOperation(
  value: unknown,
  index: number,
): GenericPatchOperation {
  const source = `JSON Patch operation ${index}`;
  if (!isRecord(value)) {
    throw new TypeError(`${source} must be a plain object`);
  }

  const fields = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${source} keys must be strings`);
    }
    if (!PATCH_OPERATION_FIELDS.has(key)) {
      throw new TypeError(`${source} has unknown field ${JSON.stringify(key)}`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${source} must use enumerable data properties`);
    }
    fields.set(key, descriptor.value);
  }

  const op = fields.get("op");
  if (op === "stream") {
    throw new TypeError(
      "Stream frames must be applied through the stream transport",
    );
  }
  if (typeof op !== "string" || !PATCH_OPERATION_NAMES.has(op)) {
    throw new TypeError(`${source} has an unsupported op`);
  }

  const path = fields.get("path");
  if (typeof path !== "string") {
    throw new TypeError(`${source} path must be a string`);
  }

  const requiresValue = op !== "remove";
  if (requiresValue !== fields.has("value")) {
    throw new TypeError(
      requiresValue
        ? `${source} requires a value`
        : `${source} remove must not contain a value`,
    );
  }

  return Object.freeze({
    op: op as GenericPatchOperationName,
    path,
    ...(requiresValue ? { value: fields.get("value") } : {}),
  });
}
