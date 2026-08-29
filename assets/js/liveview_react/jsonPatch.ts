import type { PatchOperation } from "./compactPatch";

type MutableRecord = Record<string, unknown>;
type MutableContainer = MutableRecord | unknown[];

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): value is MutableContainer {
  return Array.isArray(value) || isRecord(value);
}

function unescapePathComponent(path: string): string {
  return path.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePathComponent(
  component: string,
  array: readonly unknown[],
): string | null {
  if (!component.startsWith("$$")) return component;

  const targetId = component.substring(2);
  const index = array.findIndex(
    (item) =>
      isRecord(item) &&
      Object.hasOwn(item, "__dom_id") &&
      item.__dom_id === targetId,
  );

  if (index === -1) {
    console.warn(
      `JSON Patch: Item with __dom_id "${targetId}" not found in array, skipping operation`,
    );
    return null;
  }

  return index.toString();
}

function readPathSegment(path: string, start: number, end: number): string {
  const segment = path.slice(start, end);
  return segment.includes("~") ? unescapePathComponent(segment) : segment;
}

function resolveArrayIndex(
  key: string,
  array: readonly unknown[],
  allowAppend: boolean,
): number | null {
  if (key.startsWith("$$")) {
    const resolved = resolvePathComponent(key, array);
    return resolved === null ? null : Number.parseInt(resolved, 10);
  }

  if (key === "-") return allowAppend ? array.length : array.length - 1;

  const index = Number.parseInt(key, 10);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid JSON Patch array index: ${key}`);
  }

  return index;
}

function childAt(container: MutableContainer, key: string): unknown {
  if (Array.isArray(container)) {
    const index = resolveArrayIndex(key, container, false);
    return index === null ? undefined : container[index];
  }

  return container[key];
}

function setChild(
  container: MutableContainer,
  key: string,
  value: unknown,
): boolean {
  if (Array.isArray(container)) {
    const index = resolveArrayIndex(key, container, false);
    if (index === null) return false;
    container[index] = value;
    return true;
  }

  container[key] = value;
  return true;
}

export function getValueByPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;

  const keys = pointer.split("/").slice(1);
  let value = document;

  for (const encodedKey of keys) {
    if (!isContainer(value)) return undefined;

    const key = encodedKey.includes("~")
      ? unescapePathComponent(encodedKey)
      : encodedKey;
    value = childAt(value, key);
  }

  return value;
}

export function applyOperation<T>(document: T, operation: PatchOperation): T {
  return applyPatchOperation(
    document,
    operation.op,
    operation.path,
    operation.value,
  ) as T;
}

function requireNumericValue(operation: PatchOperation["op"], value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`JSON Patch ${operation} requires a finite number`);
  }

  return value;
}

function applyLimit(target: unknown[], value: unknown): void {
  const limit = requireNumericValue("limit", value);

  if (limit >= 0) {
    if (limit < target.length) target.splice(limit);
    return;
  }

  const keepCount = Math.abs(limit);
  if (keepCount < target.length) {
    target.splice(0, target.length - keepCount);
  }
}

function applyPatchOperation(
  document: unknown,
  operation: PatchOperation["op"],
  path: string,
  value: unknown,
): unknown {
  if (path === "") {
    switch (operation) {
      case "add":
      case "replace":
      case "upsert":
        return value;
      case "remove":
        return null;
      case "limit":
        if (!Array.isArray(document)) {
          throw new TypeError("A root limit operation requires an array");
        }
        applyLimit(document, value);
        return document;
    }
  }

  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Patch path: ${path}`);
  }

  let target: unknown = document;
  let segmentStart = 1;

  while (true) {
    const segmentEnd = path.indexOf("/", segmentStart);
    if (segmentEnd === -1) break;
    if (!isContainer(target)) {
      throw new Error(
        `JSON Patch path does not resolve to a container: ${path}`,
      );
    }

    const key = readPathSegment(path, segmentStart, segmentEnd);
    target = childAt(target, key);
    segmentStart = segmentEnd + 1;
  }

  if (!isContainer(target)) {
    throw new Error(`JSON Patch path does not resolve to a container: ${path}`);
  }

  const key = readPathSegment(path, segmentStart, path.length);

  if (Array.isArray(target)) {
    const index = resolveArrayIndex(key, target, true);
    if (index === null) return document;

    switch (operation) {
      case "add":
        target.splice(index, 0, value);
        break;
      case "remove":
        target.splice(index, 1);
        break;
      case "replace":
        target[index] = value;
        break;
      case "upsert": {
        if (isRecord(value) && Object.hasOwn(value, "__dom_id")) {
          const existingIndex = target.findIndex(
            (item) => isRecord(item) && item.__dom_id === value.__dom_id,
          );

          if (existingIndex !== -1) {
            target[existingIndex] = value;
          } else {
            target.splice(index, 0, value);
          }
        } else {
          target.splice(index, 0, value);
        }
        break;
      }
      case "limit":
        applyLimit(target, value);
        break;
    }

    return document;
  }

  switch (operation) {
    case "add":
    case "replace":
    case "upsert":
      target[key] = value;
      break;
    case "remove":
      delete target[key];
      break;
    case "limit": {
      const array = target[key];
      if (!Array.isArray(array)) {
        throw new TypeError(`JSON Patch limit target is not an array: ${path}`);
      }
      applyLimit(array, value);
      break;
    }
  }

  return document;
}

function cloneShallow(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice();
  if (isRecord(value)) return { ...value };
  return value;
}

function ensureWritablePath(
  document: unknown,
  path: string,
  touchedPaths: Set<string>,
): void {
  if (!isContainer(document)) {
    throw new TypeError("JSON Patch document must be an object or array");
  }

  let target: MutableContainer = document;
  let segmentStart = 1;
  let prefix = "";

  while (true) {
    const segmentEnd = path.indexOf("/", segmentStart);
    if (segmentEnd === -1) break;

    const key = readPathSegment(path, segmentStart, segmentEnd);
    const resolvedKey = Array.isArray(target)
      ? resolveArrayIndex(key, target, false)
      : key;
    if (resolvedKey === null) return;

    prefix += `/${resolvedKey}`;
    let child = childAt(target, String(resolvedKey));

    if (!touchedPaths.has(prefix)) {
      touchedPaths.add(prefix);
      child = cloneShallow(child);
      if (!setChild(target, String(resolvedKey), child)) return;
    }

    if (!isContainer(child)) {
      throw new Error(
        `JSON Patch path does not resolve to a container: ${path}`,
      );
    }

    target = child;
    segmentStart = segmentEnd + 1;
  }

  if (prefix !== "") return;

  const key = readPathSegment(path, segmentStart, path.length);
  const targetPrefix = `/${key}`;
  if (touchedPaths.has(targetPrefix)) return;

  touchedPaths.add(targetPrefix);
  const child = cloneShallow(childAt(target, key));
  setChild(target, key, child);
}

export function applyPatch<T>(
  document: T,
  patch: readonly PatchOperation[],
): T {
  let result = document;
  const touchedPaths = new Set<string>();

  for (const operation of patch) {
    if (operation.path === "") {
      result = applyOperation(result, operation);
      continue;
    }

    ensureWritablePath(result, operation.path, touchedPaths);
    result = applyOperation(result, operation);
  }

  return result;
}
