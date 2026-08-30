import type { ComponentRegistry, LiveViewReactRootOptions } from "../types";

type RuntimeEnvironment = "client" | "server";

interface NormalizedFactoryOptions {
  readonly components: ComponentRegistry;
  readonly rootOptions: LiveViewReactRootOptions;
}

const SHARED_OPTION_KEYS: readonly string[] = Object.freeze([
  "components",
  "strictMode",
  "wrapRoot",
]);
const CLIENT_CALLBACK_KEYS: readonly string[] = Object.freeze([
  "onCaughtError",
  "onRecoverableError",
  "onUncaughtError",
]);

function isOptionsObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type FunctionOptionKey =
  | "onCaughtError"
  | "onRecoverableError"
  | "onUncaughtError"
  | "wrapRoot";

function readOptionalFunction<TKey extends FunctionOptionKey>(
  options: Record<string, unknown>,
  key: TKey,
): NonNullable<LiveViewReactRootOptions[TKey]> | undefined {
  if (!Object.hasOwn(options, key)) return undefined;

  const value = options[key];
  if (typeof value !== "function") {
    throw new TypeError(`${key} must be a function when provided`);
  }

  return value as NonNullable<LiveViewReactRootOptions[TKey]>;
}

function assertAllowedKeys(
  options: Record<string, unknown>,
  environment: RuntimeEnvironment,
): void {
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string") {
      throw new TypeError("liveview_react options must use string keys");
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        "liveview_react options must use enumerable data properties",
      );
    }
    if (SHARED_OPTION_KEYS.includes(key)) continue;
    if (environment === "client" && CLIENT_CALLBACK_KEYS.includes(key)) {
      continue;
    }

    if (environment === "server" && CLIENT_CALLBACK_KEYS.includes(key)) {
      throw new TypeError(`${key} is a client-only liveview_react option`);
    }

    throw new TypeError(`Unknown liveview_react option "${key}"`);
  }
}

export function normalizeRootOptions(
  input: unknown,
  environment: RuntimeEnvironment,
): NormalizedFactoryOptions {
  if (!isOptionsObject(input)) {
    throw new TypeError("liveview_react options must be a plain object");
  }

  assertAllowedKeys(input, environment);
  if (!Object.hasOwn(input, "components")) {
    throw new TypeError("components is required");
  }

  let strictMode: boolean | undefined;
  if (Object.hasOwn(input, "strictMode")) {
    if (typeof input.strictMode !== "boolean") {
      throw new TypeError("strictMode must be a boolean when provided");
    }
    strictMode = input.strictMode;
  }

  const wrapRoot = readOptionalFunction(input, "wrapRoot");
  let onCaughtError: LiveViewReactRootOptions["onCaughtError"];
  let onRecoverableError: LiveViewReactRootOptions["onRecoverableError"];
  let onUncaughtError: LiveViewReactRootOptions["onUncaughtError"];

  if (environment === "client") {
    onCaughtError = readOptionalFunction(input, "onCaughtError");
    onRecoverableError = readOptionalFunction(input, "onRecoverableError");
    onUncaughtError = readOptionalFunction(input, "onUncaughtError");
  }

  const rootOptions: LiveViewReactRootOptions = Object.freeze({
    ...(strictMode !== undefined ? { strictMode } : {}),
    ...(wrapRoot ? { wrapRoot } : {}),
    ...(onCaughtError ? { onCaughtError } : {}),
    ...(onRecoverableError ? { onRecoverableError } : {}),
    ...(onUncaughtError ? { onUncaughtError } : {}),
  });

  return Object.freeze({
    components: input.components as ComponentRegistry,
    rootOptions,
  });
}
