import type {
  ChangeEvent,
  FocusEvent,
  FormEventHandler,
  RefCallback,
} from "react";

export type LiveFormPathSegment = string | number;
export type LiveFormPath = readonly LiveFormPathSegment[];

export type LiveFormValues = object;
export type LiveFormErrors = Readonly<Record<string, unknown>>;
export type LiveFormRequired = Readonly<Record<string, unknown>>;

export interface LiveFormServerSnapshot<
  TValues extends LiveFormValues = LiveFormValues,
> {
  readonly id: string;
  readonly name: string;
  readonly values: TValues;
  readonly errors: LiveFormErrors;
  readonly required: LiveFormRequired;
  readonly valid: boolean;
  readonly revision: number;
}

export interface LiveFormSubmitEvent<TSubmitReply = unknown> {
  readonly id: string;
  readonly name: string;
  readonly reply: TSubmitReply;
  readonly revision: number;
}

export interface LiveFormOptions {
  readonly changeEvent: string;
  readonly submitEvent: string;
  readonly debounce?: number;
}

export type LiveFormControl =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

export type LiveFormControlChangeEvent = ChangeEvent<LiveFormControl>;
export type LiveFormControlFocusEvent = FocusEvent<LiveFormControl>;
export type LiveFormControlValue = string | number | readonly string[];

export interface LiveFormFieldOptions {
  readonly checkedValue?: unknown;
  readonly multiple?: boolean;
  readonly required?: boolean;
  readonly type?: string;
  readonly uncheckedValue?: unknown;
  readonly value?: string | number;
}

export interface LiveFormFieldBinding {
  readonly dirty: boolean;
  readonly displayErrors: readonly string[];
  readonly errors: readonly string[];
  readonly hiddenInputProps?: LiveFormHiddenInputProps;
  readonly inputProps: LiveFormInputProps;
  readonly required: boolean;
  readonly touched: boolean;
}

export interface LiveFormInputProps {
  readonly "aria-invalid": boolean;
  readonly "aria-required": boolean;
  readonly checked?: boolean;
  readonly name: string;
  readonly onBlur: (event: LiveFormControlFocusEvent) => void;
  readonly onChange: (event: LiveFormControlChangeEvent) => void;
  readonly required: boolean;
  readonly type?: string;
  readonly value: LiveFormControlValue;
}

export interface LiveFormHiddenInputProps {
  readonly name: string;
  readonly type: "hidden";
  readonly value: string;
}

export interface LiveFormProps {
  readonly id: string;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly "phx-auto-recover": "ignore";
  readonly "phx-change": string;
  readonly "phx-submit": string;
  readonly ref: RefCallback<HTMLFormElement>;
}

export interface LiveFormRevisionInputProps {
  readonly name: "_liveview_react_revision";
  readonly type: "hidden";
  readonly value: string;
}

const BLOCKED_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const RESERVED_FORM_NAMES = new Set([
  ...BLOCKED_PATH_SEGMENTS,
  "_liveview_react_revision",
  "_target",
]);
const MAX_LIVE_FORM_NESTING_DEPTH = 64;

const SERVER_FORM_KEYS = new Set([
  "errors",
  "id",
  "name",
  "required",
  "revision",
  "valid",
  "values",
]);
const SUBMIT_EVENT_KEYS = new Set(["id", "name", "reply", "revision"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeObjectKey(key: string, source: string): void {
  if (BLOCKED_PATH_SEGMENTS.has(key)) {
    throw new TypeError(`${source} contains forbidden key "${key}"`);
  }
}

function assertLiveFormName(
  name: unknown,
  source: string,
): asserts name is string {
  if (typeof name !== "string" || name === "") {
    throw new TypeError(`${source} must be a non-empty string`);
  }
  if (RESERVED_FORM_NAMES.has(name)) {
    throw new TypeError(`${source} uses reserved name "${name}"`);
  }
}

function enterLiveFormContainer(
  value: object,
  source: string,
  ancestors: readonly object[],
  depth: number,
): Readonly<{ ancestors: readonly object[]; depth: number }> {
  if (depth >= MAX_LIVE_FORM_NESTING_DEPTH) {
    throw new TypeError(
      `${source} exceeds the maximum live form nesting depth of ${MAX_LIVE_FORM_NESTING_DEPTH}`,
    );
  }
  if (ancestors.includes(value)) {
    throw new TypeError(`${source} contains a cyclic reference`);
  }

  return Object.freeze({
    ancestors: Object.freeze([...ancestors, value]),
    depth: depth + 1,
  });
}

function cloneJsonValue(
  value: unknown,
  source: string,
  ancestors: readonly object[] = Object.freeze([]),
  depth = 0,
): unknown {
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

  if (Array.isArray(value)) {
    const next = enterLiveFormContainer(value, source, ancestors, depth);
    return Object.freeze(
      value.map((entry, index) =>
        cloneJsonValue(
          entry,
          `${source}[${index}]`,
          next.ancestors,
          next.depth,
        ),
      ),
    );
  }

  if (!isPlainRecord(value)) {
    throw new TypeError(`${source} must contain only JSON-compatible values`);
  }

  const next = enterLiveFormContainer(value, source, ancestors, depth);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSafeObjectKey(key, source);
    result[key] = cloneJsonValue(
      entry,
      `${source}.${key}`,
      next.ancestors,
      next.depth,
    );
  }
  return Object.freeze(result);
}

function cloneErrorTree(
  value: unknown,
  source: string,
  ancestors: readonly object[] = Object.freeze([]),
  depth = 0,
  arrayEntry = false,
): unknown {
  if (value === null) return value;
  if (typeof value === "string") {
    if (arrayEntry) return value;
    throw new TypeError(`${source} error leaves must be arrays of strings`);
  }

  if (Array.isArray(value)) {
    const next = enterLiveFormContainer(value, source, ancestors, depth);
    return Object.freeze(
      value.map((entry, index) =>
        cloneErrorTree(
          entry,
          `${source}[${index}]`,
          next.ancestors,
          next.depth,
          true,
        ),
      ),
    );
  }

  if (!isPlainRecord(value)) {
    throw new TypeError(
      `${source} must be a nested object/list tree with string leaves`,
    );
  }

  const next = enterLiveFormContainer(value, source, ancestors, depth);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSafeObjectKey(key, source);
    result[key] = cloneErrorTree(
      entry,
      `${source}.${key}`,
      next.ancestors,
      next.depth,
    );
  }
  return Object.freeze(result);
}

function cloneRequiredTree(
  value: unknown,
  source: string,
  ancestors: readonly object[] = Object.freeze([]),
  depth = 0,
): unknown {
  if (value === null || value === true) return value;
  if (value === false) {
    throw new TypeError(`${source} required leaves must be true`);
  }

  if (Array.isArray(value)) {
    const next = enterLiveFormContainer(value, source, ancestors, depth);
    return Object.freeze(
      value.map((entry, index) =>
        cloneRequiredTree(
          entry,
          `${source}[${index}]`,
          next.ancestors,
          next.depth,
        ),
      ),
    );
  }

  if (!isPlainRecord(value)) {
    throw new TypeError(
      `${source} must be a nested object/list tree with boolean leaves`,
    );
  }

  const next = enterLiveFormContainer(value, source, ancestors, depth);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSafeObjectKey(key, source);
    result[key] = cloneRequiredTree(
      entry,
      `${source}.${key}`,
      next.ancestors,
      next.depth,
    );
  }
  return Object.freeze(result);
}

function assertExactServerFormKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!SERVER_FORM_KEYS.has(key)) {
      throw new TypeError(`useLiveForm serverForm has unknown key "${key}"`);
    }
  }

  for (const key of [
    "errors",
    "id",
    "name",
    "required",
    "revision",
    "valid",
    "values",
  ]) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`useLiveForm serverForm.${key} is required`);
    }
  }
}

export function validateLiveFormServerSnapshot<TValues extends LiveFormValues>(
  value: unknown,
): LiveFormServerSnapshot<TValues> {
  if (!isPlainRecord(value)) {
    throw new TypeError("useLiveForm serverForm must be a plain object");
  }

  assertExactServerFormKeys(value);
  if (typeof value.id !== "string" || value.id === "") {
    throw new TypeError("useLiveForm serverForm.id must be a non-empty string");
  }
  assertLiveFormName(value.name, "useLiveForm serverForm.name");
  if (!isPlainRecord(value.values)) {
    throw new TypeError("useLiveForm serverForm.values must be a plain object");
  }
  if (!isPlainRecord(value.errors)) {
    throw new TypeError("useLiveForm serverForm.errors must be a plain object");
  }
  if (!isPlainRecord(value.required)) {
    throw new TypeError(
      "useLiveForm serverForm.required must be a plain object",
    );
  }
  if (typeof value.valid !== "boolean") {
    throw new TypeError("useLiveForm serverForm.valid must be a boolean");
  }
  if (
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new TypeError(
      "useLiveForm serverForm.revision must be a non-negative safe integer",
    );
  }

  const values = cloneJsonValue(
    value.values,
    "useLiveForm serverForm.values",
  ) as TValues;
  const errors = cloneErrorTree(
    value.errors,
    "useLiveForm serverForm.errors",
  ) as LiveFormErrors;
  const required = cloneRequiredTree(
    value.required,
    "useLiveForm serverForm.required",
  ) as LiveFormRequired;
  return Object.freeze({
    errors,
    id: value.id,
    name: value.name,
    required,
    revision: value.revision,
    valid: value.valid,
    values,
  });
}

export function validateLiveFormSubmitEvent<TSubmitReply = unknown>(
  value: unknown,
): LiveFormSubmitEvent<TSubmitReply> {
  if (!isPlainRecord(value)) {
    throw new TypeError("live form submit event must be a plain object");
  }
  for (const key of Object.keys(value)) {
    if (!SUBMIT_EVENT_KEYS.has(key)) {
      throw new TypeError(`live form submit event has unknown key "${key}"`);
    }
  }
  for (const key of SUBMIT_EVENT_KEYS) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`live form submit event.${key} is required`);
    }
  }
  if (typeof value.id !== "string" || value.id === "") {
    throw new TypeError("live form submit event.id must be a non-empty string");
  }
  assertLiveFormName(value.name, "live form submit event.name");
  if (
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new TypeError(
      "live form submit event.revision must be a non-negative safe integer",
    );
  }

  return Object.freeze({
    id: value.id,
    name: value.name,
    reply: cloneJsonValue(
      value.reply,
      "live form submit event.reply",
    ) as TSubmitReply,
    revision: value.revision,
  });
}

export function validateLiveFormOptions(
  options: LiveFormOptions,
): Required<LiveFormOptions> {
  if (!isPlainRecord(options)) {
    throw new TypeError("useLiveForm options must be a plain object");
  }

  for (const key of Object.keys(options)) {
    if (!new Set(["changeEvent", "debounce", "submitEvent"]).has(key)) {
      throw new TypeError(`useLiveForm options has unknown key "${key}"`);
    }
  }

  if (typeof options.changeEvent !== "string" || options.changeEvent === "") {
    throw new TypeError(
      "useLiveForm options.changeEvent must be a non-empty string",
    );
  }
  if (typeof options.submitEvent !== "string" || options.submitEvent === "") {
    throw new TypeError(
      "useLiveForm options.submitEvent must be a non-empty string",
    );
  }

  const debounce = options.debounce ?? 150;
  if (!Number.isFinite(debounce) || debounce < 0) {
    throw new TypeError(
      "useLiveForm options.debounce must be a non-negative finite number",
    );
  }

  return Object.freeze({
    changeEvent: options.changeEvent,
    debounce,
    submitEvent: options.submitEvent,
  });
}

export function validateLiveFormPath(path: LiveFormPath): LiveFormPath {
  if (!Array.isArray(path) || path.length === 0) {
    throw new TypeError("Live form paths must be non-empty arrays");
  }

  return Object.freeze(
    path.map((segment, index) => {
      if (typeof segment === "string") {
        if (segment === "") {
          throw new TypeError(
            `Live form path segment ${index} must not be empty`,
          );
        }
        if (segment.includes("[") || segment.includes("]")) {
          throw new TypeError(
            `Live form path segment ${index} must not contain brackets`,
          );
        }
        assertSafeObjectKey(segment, `Live form path segment ${index}`);
        return segment;
      }

      if (Number.isSafeInteger(segment) && segment >= 0) return segment;

      throw new TypeError(
        `Live form path segment ${index} must be a non-empty string or non-negative safe integer`,
      );
    }),
  );
}

export function liveFormPathKey(path: LiveFormPath): string {
  return JSON.stringify(validateLiveFormPath(path));
}

export function getLiveFormValue(value: unknown, path: LiveFormPath): unknown {
  const validatedPath = validateLiveFormPath(path);
  let current = value;

  for (const segment of validatedPath) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isPlainRecord(current)) return undefined;
      current = current[segment];
    }
  }

  return current;
}

function copyWithValue(
  current: unknown,
  path: LiveFormPath,
  index: number,
  nextValue: unknown,
): unknown {
  const segment = path[index];
  if (segment === undefined) return nextValue;

  if (typeof segment === "number") {
    const source = current === undefined || current === null ? [] : current;
    if (!Array.isArray(source)) {
      throw new TypeError(
        `Cannot use numeric live form path segment ${segment} on a non-array value`,
      );
    }
    if (segment > source.length) {
      throw new RangeError(
        `Live form array path segment ${segment} exceeds length ${source.length}`,
      );
    }

    const previous = source[segment];
    const child = copyWithValue(previous, path, index + 1, nextValue);
    if (Object.is(previous, child)) return source;

    const result = source.slice();
    result[segment] = child;
    return Object.freeze(result);
  }

  const source = current === undefined || current === null ? {} : current;
  if (!isPlainRecord(source)) {
    throw new TypeError(
      `Cannot use string live form path segment "${segment}" on a non-object value`,
    );
  }

  const previous = source[segment];
  const child = copyWithValue(previous, path, index + 1, nextValue);
  if (Object.is(previous, child)) return source;

  return Object.freeze({ ...source, [segment]: child });
}

export function setLiveFormValue<TValue>(
  value: TValue,
  path: LiveFormPath,
  nextValue: unknown,
): TValue {
  const validatedPath = validateLiveFormPath(path);
  const clonedValue = cloneJsonValue(nextValue, "Live form field value");
  return copyWithValue(value, validatedPath, 0, clonedValue) as TValue;
}

export function formatPhoenixFieldName(
  formName: string,
  path: LiveFormPath,
): string {
  assertLiveFormName(formName, "Phoenix form name");

  return validateLiveFormPath(path).reduce<string>(
    (name, segment) => `${name}[${String(segment)}]`,
    formName,
  );
}

export function liveFormValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((entry, index) =>
      liveFormValuesEqual(entry, right[index]),
    );
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && liveFormValuesEqual(left[key], right[key]),
    );
  }
  return false;
}

export function errorsAtLiveFormPath(
  errors: LiveFormErrors,
  path: LiveFormPath,
): readonly string[] {
  const value = getLiveFormValue(errors, path);
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.filter((entry): entry is string => typeof entry === "string"),
  );
}

export function requiredAtLiveFormPath(
  required: LiveFormRequired,
  path: LiveFormPath,
): boolean {
  return getLiveFormValue(required, path) === true;
}

function includesControlValue(
  values: readonly unknown[],
  candidate: unknown,
): boolean {
  return values.some((value) => liveFormValuesEqual(value, candidate));
}

export function normalizeLiveFormControlValue(
  control: LiveFormControl,
  currentValue: unknown,
  options: LiveFormFieldOptions = {},
): unknown {
  if (control instanceof HTMLSelectElement) {
    if (control.multiple) {
      return Object.freeze(
        Array.from(control.selectedOptions, (option) => option.value),
      );
    }
    return control.value;
  }

  if (control instanceof HTMLTextAreaElement) return control.value;

  const type = (options.type ?? control.type).toLowerCase();
  if (type === "checkbox") {
    const checkedValue = options.checkedValue ?? options.value ?? true;
    if (options.multiple) {
      const values = Array.isArray(currentValue) ? currentValue : [];
      const withoutValue = values.filter(
        (value) => !liveFormValuesEqual(value, checkedValue),
      );
      return control.checked
        ? Object.freeze([...withoutValue, checkedValue])
        : Object.freeze(withoutValue);
    }

    return control.checked ? checkedValue : (options.uncheckedValue ?? false);
  }

  if (type === "radio") {
    return control.checked ? (options.value ?? control.value) : currentValue;
  }

  if (type === "number" || type === "range") {
    if (control.value === "") return null;
    return Number.isFinite(control.valueAsNumber)
      ? control.valueAsNumber
      : control.value;
  }

  return control.value;
}

export function toLiveFormControlValue(value: unknown): LiveFormControlValue {
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry) =>
        typeof entry === "string" || typeof entry === "number"
          ? String(entry)
          : "",
      ),
    );
  }
  return "";
}

export function isLiveFormControlChecked(
  value: unknown,
  options: LiveFormFieldOptions,
): boolean | undefined {
  const type = options.type?.toLowerCase();
  if (type === "radio") {
    return liveFormValuesEqual(value, options.value);
  }
  if (type !== "checkbox") return undefined;

  const checkedValue = options.checkedValue ?? options.value ?? true;
  return Array.isArray(value)
    ? includesControlValue(value, checkedValue)
    : liveFormValuesEqual(value, checkedValue) ||
        (options.checkedValue === undefined &&
          options.value === undefined &&
          value === true);
}
