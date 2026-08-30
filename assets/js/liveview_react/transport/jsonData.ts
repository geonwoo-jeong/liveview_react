import type { ComponentProps, JsonObject, JsonValue, SlotMap } from "../types";

const UNSAFE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertSafePropertyName(name: string, source: string): void {
  if (UNSAFE_PROPERTY_NAMES.has(name)) {
    throw new TypeError(
      `${source} cannot contain prototype-sensitive key ${JSON.stringify(name)}`,
    );
  }
}

export function enumerableDataEntries(
  value: Record<string, unknown>,
  source: string,
): readonly (readonly [string, unknown])[] {
  const entries: (readonly [string, unknown])[] = [];

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${source} keys must be strings`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${source} must use enumerable data properties`);
    }

    entries.push(Object.freeze([key, descriptor.value] as const));
  }

  return Object.freeze(entries);
}

export function dataPropertyMap(
  value: unknown,
  source: string,
): ReadonlyMap<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must be a plain object`);
  }

  return new Map(enumerableDataEntries(value, source));
}

export function defineDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

export function normalizeComponentProps(
  value: unknown,
  source: string,
): ComponentProps {
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must be a plain object`);
  }

  const normalized: Record<string, unknown> = Object.create(null);
  for (const [key, item] of enumerableDataEntries(value, source)) {
    assertSafePropertyName(key, source);
    defineDataProperty(normalized, key, item);
  }
  return Object.freeze(normalized);
}

export function normalizeSlotMap(value: unknown, source: string): SlotMap {
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must be a plain object`);
  }

  const normalized: Record<string, string> = Object.create(null);
  for (const [slotName, slot] of enumerableDataEntries(value, source)) {
    assertSafePropertyName(slotName, source);
    if (typeof slot !== "string") {
      throw new TypeError(`${source} slot "${slotName}" must be a string`);
    }
    defineDataProperty(normalized, slotName, slot);
  }
  return Object.freeze(normalized);
}

export function normalizeJsonArray(
  value: unknown[],
  source: string,
  ancestors: ReadonlySet<object>,
): readonly JsonValue[] {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)),
    )
  ) {
    throw new TypeError(`${source} arrays must be dense and unextended`);
  }

  const nextAncestors = new Set(ancestors).add(value);
  const normalized = value.map((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${source} arrays must use data elements`);
    }
    return normalizeJsonValue(
      descriptor.value,
      `${source}[${index}]`,
      nextAncestors,
    );
  });
  return Object.freeze(normalized);
}

function normalizeJsonValue(
  value: unknown,
  source: string,
  ancestors: ReadonlySet<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${source} numbers must be finite`);
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${source} must contain only JSON values`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${source} must not contain cycles`);
  }
  if (Array.isArray(value)) {
    return normalizeJsonArray(value, source, ancestors);
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must contain only plain JSON objects`);
  }

  const nextAncestors = new Set(ancestors).add(value);
  const normalized: Record<string, JsonValue> = Object.create(null);
  for (const [key, item] of enumerableDataEntries(value, source)) {
    assertSafePropertyName(key, source);
    defineDataProperty(
      normalized,
      key,
      normalizeJsonValue(item, `${source}.${key}`, nextAncestors),
    );
  }
  return Object.freeze(normalized) as JsonObject;
}

export function validateAndFreezeJsonValue(
  value: unknown,
  source: string,
  ancestors: ReadonlySet<object>,
): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${source} numbers must be finite`);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${source} must contain only JSON values`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${source} must not contain cycles`);
  }

  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)),
      )
    ) {
      throw new TypeError(`${source} arrays must be dense and unextended`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${source} arrays must use data elements`);
      }
      validateAndFreezeJsonValue(
        descriptor.value,
        `${source}[${index}]`,
        nextAncestors,
      );
    }
    Object.freeze(value);
    return;
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must contain only plain JSON objects`);
  }
  for (const [key, item] of enumerableDataEntries(value, source)) {
    assertSafePropertyName(key, source);
    validateAndFreezeJsonValue(item, `${source}.${key}`, nextAncestors);
  }
  Object.freeze(value);
}
