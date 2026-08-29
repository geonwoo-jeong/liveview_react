import type { ComponentProps } from "../types";
import { readLiveSocketCommands } from "./live-socket";

interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject;

type EventPayload = Readonly<Record<string, JsonValue>>;
type EventCommand = readonly [string, Readonly<Record<string, JsonValue>>];
type EventCommands = readonly EventCommand[];
export type EventCommandMap = Readonly<Record<string, EventCommands>>;
type EventCallback = (payload?: EventPayload) => void;
type EventCallbackProps = Readonly<Record<string, EventCallback>>;

interface EventCallbackCacheOptions {
  readonly element: HTMLElement;
  readonly liveSocket: unknown;
}

interface CachedEventCallback {
  readonly callback: EventCallback;
  readonly fingerprint: string;
  readonly token: object;
}

const EVENT_PROP_NAME = /^on[A-Z][A-Za-z0-9]*$/;
const OPERATION_NAME = /^[a-z][a-z0-9_]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function enumerableDataEntries(
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

function normalizeJsonArray(
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
        (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)),
    )
  ) {
    throw new TypeError(`${source} arrays must not be sparse or extended`);
  }

  const nextAncestors = new Set(ancestors).add(value);
  const normalized: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${source} arrays must use data elements`);
    }
    normalized.push(
      normalizeJsonValue(
        descriptor.value,
        `${source}[${index}]`,
        nextAncestors,
      ),
    );
  }

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
    throw new TypeError(`${source} must contain only JSON values`);
  }

  const nextAncestors = new Set(ancestors).add(value);
  const normalized: Record<string, JsonValue> = Object.create(null);
  for (const [key, item] of enumerableDataEntries(value, source)) {
    normalized[key] = normalizeJsonValue(
      item,
      `${source}.${key}`,
      nextAncestors,
    );
  }
  return Object.freeze(normalized);
}

function normalizeJsonObject(
  value: unknown,
  source: string,
): Readonly<Record<string, JsonValue>> {
  const normalized = normalizeJsonValue(value, source, new Set());
  if (!isPlainObject(normalized)) {
    throw new TypeError(`${source} must be a plain JSON object`);
  }
  return normalized;
}

function normalizeCommands(value: unknown, source: string): EventCommands {
  if (!Array.isArray(value)) {
    throw new TypeError(`${source} must be a Phoenix JS command array`);
  }

  return Object.freeze(
    value.map((command, index) => {
      const commandSource = `${source}[${index}]`;
      if (!Array.isArray(command) || command.length !== 2) {
        throw new TypeError(
          `${commandSource} must be a [operation, options] tuple`,
        );
      }

      const [operation, options] = command;
      if (
        typeof operation !== "string" ||
        !OPERATION_NAME.test(operation)
      ) {
        throw new TypeError(
          `${commandSource} operation must be a lowercase command name`,
        );
      }

      return Object.freeze([
        operation,
        normalizeJsonObject(options, `${commandSource} options`),
      ] as const);
    }),
  );
}

export function normalizeEventCommandMap(
  value: unknown,
  source: string,
): EventCommandMap {
  if (!isPlainObject(value)) {
    throw new TypeError(`${source} must contain a JSON object`);
  }

  const normalized: Record<string, EventCommands> = Object.create(null);
  for (const [propName, commands] of enumerableDataEntries(value, source)) {
    if (!EVENT_PROP_NAME.test(propName)) {
      throw new TypeError(
        `${source} key "${propName}" must be a React onCamelCase prop name`,
      );
    }
    normalized[propName] = normalizeCommands(
      commands,
      `${source}.${propName}`,
    );
  }

  return Object.freeze(normalized);
}

export function assertNoEventPropCollisions(
  props: ComponentProps,
  events: Readonly<Record<string, unknown>>,
  source: string,
): void {
  const collision = Object.keys(events).find((propName) =>
    Object.hasOwn(props, propName),
  );
  if (collision) {
    throw new TypeError(
      `${source} cannot contain both ordinary prop "${collision}" and an event callback with the same name`,
    );
  }
}

export function mergeEventCallbackProps(
  props: ComponentProps,
  callbacks: EventCallbackProps,
  source: string,
): ComponentProps {
  assertNoEventPropCollisions(props, callbacks, source);
  return Object.freeze({ ...props, ...callbacks });
}

function mergePayload(
  callbackName: string,
  commands: EventCommands,
  payload: EventPayload | undefined,
): EventCommands {
  if (payload === undefined) return commands;
  if (!isPlainObject(payload)) {
    throw new TypeError(
      `Event callback "${callbackName}" payload must be a plain JSON object`,
    );
  }

  const normalizedPayload = normalizeJsonObject(
    payload,
    `Event callback "${callbackName}" payload`,
  );
  return Object.freeze(
    commands.map(([operation, options]) => {
      if (operation !== "push") return [operation, options] as const;

      const staticValue = Object.hasOwn(options, "value")
        ? normalizeJsonObject(
            options.value,
            `Event callback "${callbackName}" JS.push value`,
          )
        : Object.freeze({});

      return Object.freeze([
        operation,
        Object.freeze({
          ...options,
          value: Object.freeze({ ...staticValue, ...normalizedPayload }),
        }),
      ] as const);
    }),
  );
}

export function createUnavailableEventCallbacks(
  events: EventCommandMap,
): EventCallbackProps {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(events).map((callbackName) => [
        callbackName,
        () => {
          throw new Error(
            `Event callback "${callbackName}" is unavailable during server rendering or hydration`,
          );
        },
      ]),
    ),
  );
}

export class EventCallbackCache {
  readonly #element: HTMLElement;
  readonly #liveSocket: unknown;
  #destroyed = false;
  #entries: ReadonlyMap<string, CachedEventCallback> = new Map();

  constructor({ element, liveSocket }: EventCallbackCacheOptions) {
    this.#element = element;
    this.#liveSocket = liveSocket;
  }

  update(events: EventCommandMap): EventCallbackProps {
    if (this.#destroyed) {
      throw new Error("Cannot update a destroyed event callback cache");
    }

    const nextEntries = new Map<string, CachedEventCallback>();
    const callbacks: Record<string, EventCallback> = Object.create(null);

    for (const [callbackName, commands] of Object.entries(events)) {
      const fingerprint = JSON.stringify(commands);
      const cached = this.#entries.get(callbackName);
      const token =
        cached?.fingerprint === fingerprint ? cached.token : Object.freeze({});
      const callback =
        cached?.fingerprint === fingerprint
          ? cached.callback
          : this.#createCallback(callbackName, commands, token);

      nextEntries.set(
        callbackName,
        Object.freeze({ callback, fingerprint, token }),
      );
      callbacks[callbackName] = callback;
    }

    this.#entries = nextEntries;
    return Object.freeze(callbacks);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#entries = new Map();
  }

  #createCallback(
    callbackName: string,
    commands: EventCommands,
    token: object,
  ): EventCallback {
    return (payload?: EventPayload) => {
      if (this.#entries.get(callbackName)?.token !== token) return;

      const liveSocketCommands = readLiveSocketCommands(this.#liveSocket);
      if (
        liveSocketCommands === null ||
        typeof liveSocketCommands.exec !== "function"
      ) {
        throw new Error(
          `Event callback "${callbackName}" requires the current public js().exec API`,
        );
      }

      liveSocketCommands.exec(
        this.#element,
        mergePayload(callbackName, commands, payload),
      );
    };
  }
}
