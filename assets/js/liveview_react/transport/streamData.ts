import type { StreamItem, StreamMap } from "../types";
import {
  assertSafePropertyName,
  defineDataProperty,
  enumerableDataEntries,
  isPlainObject,
  normalizeJsonArray,
  validateAndFreezeJsonValue,
} from "./jsonData";

function assertStreamItems(
  items: readonly unknown[],
  source: string,
): asserts items is readonly StreamItem[] {
  const seenDomIds = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!isPlainObject(item)) {
      throw new TypeError(`${source}[${index}] must be a plain JSON object`);
    }
    const domId = item.__dom_id;
    if (typeof domId !== "string" || domId.length === 0) {
      throw new TypeError(
        `${source}[${index}].__dom_id must be a non-empty string`,
      );
    }
    if (seenDomIds.has(domId)) {
      throw new TypeError(
        `${source} contains duplicate __dom_id ${JSON.stringify(domId)}`,
      );
    }
    seenDomIds.add(domId);
  }
}

export function normalizeStreamMap(value: unknown, source: string): StreamMap {
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must be a plain object`);
  }

  const normalized: Record<string, readonly StreamItem[]> = Object.create(null);
  for (const [streamName, stream] of enumerableDataEntries(value, source)) {
    assertSafePropertyName(streamName, source);
    if (!Array.isArray(stream)) {
      throw new TypeError(`${source}.${streamName} must be an array`);
    }

    const normalizedItems = normalizeJsonArray(
      stream,
      `${source}.${streamName}`,
      new Set(),
    );
    assertStreamItems(normalizedItems, `${source}.${streamName}`);
    defineDataProperty(normalized, streamName, normalizedItems);
  }
  return Object.freeze(normalized);
}

export function validateAndFreezeStreamMap(
  value: unknown,
  source: string,
): StreamMap {
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must be a plain object`);
  }

  for (const [streamName, stream] of enumerableDataEntries(value, source)) {
    assertSafePropertyName(streamName, source);
    if (!Array.isArray(stream)) {
      throw new TypeError(`${source}.${streamName} must be an array`);
    }

    validateAndFreezeJsonValue(stream, `${source}.${streamName}`, new Set());
    assertStreamItems(stream, `${source}.${streamName}`);
  }
  return Object.freeze(value) as StreamMap;
}
