export type PatchOperationName = "add" | "remove" | "replace" | "stream";

export interface PatchOperation {
  readonly op: PatchOperationName;
  readonly path: string;
  readonly value?: unknown;
}

interface LengthResult {
  readonly value: number;
  readonly offset: number;
}

export function decodeCompactPatch(
  payload: string | null,
): readonly PatchOperation[] {
  if (payload === null || payload === "") return Object.freeze([]);

  const operations: PatchOperation[] = [];
  let offset = 0;

  while (offset < payload.length) {
    const code = payload[offset++];
    if (code === undefined) {
      throw new Error("Unexpected end of LiveViewReact patch payload");
    }

    const op = opFromCode(code);
    const pathLength = readLength(payload, offset);
    offset = pathLength.offset;

    const pathResult = readSegment(payload, offset, pathLength.value);
    const path = pathResult.value;
    offset = pathResult.offset;

    if (op === "remove") {
      operations.push(Object.freeze({ op, path }));
      continue;
    }

    const tag = payload[offset++];
    if (tag === undefined) {
      throw new Error("Unexpected end of LiveViewReact patch payload");
    }

    if (tag === "z") {
      operations.push(Object.freeze({ op, path, value: null }));
      continue;
    }

    if (tag === "b") {
      const bit = payload[offset++];
      if (bit !== "0" && bit !== "1") {
        throw new Error(
          `Invalid LiveViewReact boolean payload: ${String(bit)}`,
        );
      }

      operations.push(Object.freeze({ op, path, value: bit === "1" }));
      continue;
    }

    if (tag !== "n" && tag !== "s" && tag !== "J") {
      throw new Error(`Unknown LiveViewReact patch value tag: ${tag}`);
    }

    const valueLength = readLength(payload, offset);
    offset = valueLength.offset;
    const valueResult = readSegment(payload, offset, valueLength.value);
    offset = valueResult.offset;

    const value = decodeValue(tag, valueResult.value);
    operations.push(Object.freeze({ op, path, value }));
  }

  return Object.freeze(operations);
}

function opFromCode(code: string): PatchOperationName {
  switch (code) {
    case "a":
      return "add";
    case "d":
      return "remove";
    case "r":
      return "replace";
    case "s":
      return "stream";
    default:
      throw new Error(`Unknown LiveViewReact patch operation code: ${code}`);
  }
}

function readLength(payload: string, offset: number): LengthResult {
  let value = 0;
  let hasDigits = false;

  while (offset < payload.length) {
    const code = payload.charCodeAt(offset);
    if (code < 48 || code > 57) break;

    const digit = code - 48;
    if (value > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) {
      throw new Error(
        "LiveViewReact patch length exceeds the safe integer range",
      );
    }

    value = value * 10 + digit;
    offset += 1;
    hasDigits = true;
  }

  if (!hasDigits || payload[offset] !== ":") {
    throw new Error("Invalid LiveViewReact patch length prefix");
  }

  return Object.freeze({ value, offset: offset + 1 });
}

function readSegment(
  payload: string,
  offset: number,
  length: number,
): { readonly value: string; readonly offset: number } {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || end > payload.length) {
    throw new Error("Unexpected end of LiveViewReact patch payload");
  }

  return Object.freeze({ value: payload.slice(offset, end), offset: end });
}

function decodeValue(tag: "n" | "s" | "J", rawValue: string): unknown {
  if (tag === "s") return rawValue;
  if (tag === "J") return decodeCompactJson(rawValue);

  if (!JSON_NUMBER_PATTERN.test(rawValue)) {
    throw new Error(`Invalid LiveViewReact numeric payload: ${rawValue}`);
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid LiveViewReact numeric payload: ${rawValue}`);
  }

  return value;
}

const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function decodeCompactJson(value: string): unknown {
  let json = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "^") {
      json += '"';
      continue;
    }

    if (character !== "~") {
      json += character;
      continue;
    }

    const escaped = value[++index];
    if (escaped !== "~" && escaped !== "^") {
      throw new Error("Invalid LiveViewReact compact JSON escape");
    }

    json += escaped;
  }

  return JSON.parse(json);
}
