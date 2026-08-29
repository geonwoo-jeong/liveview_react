import type {
  LiveUploadConfig,
  LiveUploadEntry,
  LiveViewTarget,
  UploadFiles,
} from "./types";

const CONFIG_KEYS = Object.freeze([
  "accept",
  "auto_upload",
  "entries",
  "errors",
  "max_entries",
  "max_entries_mode",
  "max_file_size",
  "name",
  "ref",
]);

const ENTRY_KEYS = Object.freeze([
  "cancelled",
  "client_last_modified",
  "client_name",
  "client_relative_path",
  "client_size",
  "client_type",
  "done",
  "errors",
  "preflighted",
  "progress",
  "ref",
  "valid",
]);

const CONFIG_ERROR_KEYS = Object.freeze(["error", "ref"]);
const MAX_ENCODED_NESTING_DEPTH = 64;
const FORBIDDEN_ENCODED_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export interface NormalizedLiveUploadEntry extends LiveUploadEntry {
  readonly cancelled: boolean;
  readonly client_last_modified: number;
  readonly client_relative_path: string;
}

export interface NormalizedLiveUploadError {
  readonly error: unknown;
  readonly ref: string;
}

export interface NormalizedLiveUploadConfig extends LiveUploadConfig {
  readonly entries: readonly NormalizedLiveUploadEntry[];
  readonly errors: readonly NormalizedLiveUploadError[];
  readonly max_entries_mode: "selected" | "total";
  readonly max_file_size: number;
}

export interface ResolveLiveUploadInputOptions {
  readonly bridgeElement: HTMLElement | null;
  readonly changeEvent?: string;
  readonly formId?: string;
  readonly submitEvent?: string;
  readonly target?: LiveViewTarget;
}

export interface ResolvedLiveUploadInput {
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  source: string,
): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  const missing = expectedKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );

  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
      ...(unexpected.length > 0 ? [`unexpected ${unexpected.join(", ")}`] : []),
    ].join("; ");
    throw new TypeError(`${source} has invalid fields: ${details}`);
  }
}

function assertNonEmptyString(value: unknown, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${source} must be a non-empty string`);
  }
  return value;
}

function assertString(value: unknown, source: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${source} must be a string`);
  }
  return value;
}

function assertBoolean(value: unknown, source: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${source} must be a boolean`);
  }
  return value;
}

function assertSafeInteger(
  value: unknown,
  source: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    const qualifier = minimum === 0 ? "non-negative" : "positive";
    throw new TypeError(`${source} must be a ${qualifier} safe integer`);
  }
  return value as number;
}

function cloneEncodedValue(
  value: unknown,
  source: string,
  ancestors: ReadonlySet<object> = new Set(),
  depth = 0,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${source} must contain only encoded JSON values`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_ENCODED_NESTING_DEPTH) {
      throw new TypeError(
        `${source} exceeds the maximum encoded nesting depth of ${MAX_ENCODED_NESTING_DEPTH}`,
      );
    }
    if (ancestors.has(value)) {
      throw new TypeError(`${source} must not contain cyclic values`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    return Object.freeze(
      value.map((item, index) =>
        cloneEncodedValue(
          item,
          `${source}[${index}]`,
          nextAncestors,
          depth + 1,
        ),
      ),
    );
  }
  if (isRecord(value)) {
    if (depth >= MAX_ENCODED_NESTING_DEPTH) {
      throw new TypeError(
        `${source} exceeds the maximum encoded nesting depth of ${MAX_ENCODED_NESTING_DEPTH}`,
      );
    }
    if (ancestors.has(value)) {
      throw new TypeError(`${source} must not contain cyclic values`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          if (FORBIDDEN_ENCODED_KEYS.has(key)) {
            throw new TypeError(
              `${source} contains forbidden object key "${key}"`,
            );
          }
          return [
            key,
            cloneEncodedValue(
              item,
              `${source}.${key}`,
              nextAncestors,
              depth + 1,
            ),
          ];
        }),
      ),
    );
  }

  throw new TypeError(`${source} must contain only encoded JSON values`);
}

function normalizeErrors(value: unknown, source: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${source} must be an array`);
  }
  return Object.freeze(
    value.map((error, index) =>
      cloneEncodedValue(error, `${source}[${index}]`),
    ),
  );
}

function normalizeEntry(
  value: unknown,
  source: string,
): NormalizedLiveUploadEntry {
  if (!isRecord(value)) {
    throw new TypeError(`${source} must be an object`);
  }
  assertExactKeys(value, ENTRY_KEYS, source);

  const progress = assertSafeInteger(value.progress, `${source}.progress`, 0);
  if (progress > 100) {
    throw new TypeError(`${source}.progress must be between 0 and 100`);
  }

  return Object.freeze({
    cancelled: assertBoolean(value.cancelled, `${source}.cancelled`),
    client_last_modified: assertSafeInteger(
      value.client_last_modified,
      `${source}.client_last_modified`,
      0,
    ),
    client_name: assertString(value.client_name, `${source}.client_name`),
    client_relative_path: assertString(
      value.client_relative_path,
      `${source}.client_relative_path`,
    ),
    client_size: assertSafeInteger(
      value.client_size,
      `${source}.client_size`,
      0,
    ),
    client_type: assertString(value.client_type, `${source}.client_type`),
    done: assertBoolean(value.done, `${source}.done`),
    errors: normalizeErrors(value.errors, `${source}.errors`),
    preflighted: assertBoolean(value.preflighted, `${source}.preflighted`),
    progress,
    ref: assertNonEmptyString(value.ref, `${source}.ref`),
    valid: assertBoolean(value.valid, `${source}.valid`),
  });
}

function normalizeAccept(value: unknown): "any" | readonly string[] {
  if (value === "any") return "any";
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new TypeError(
      'useLiveUpload config.accept must be "any" or a non-empty array of strings',
    );
  }

  if (new Set(value).size !== value.length) {
    throw new TypeError(
      "useLiveUpload config.accept must not contain duplicates",
    );
  }
  return Object.freeze([...value]);
}

function normalizeConfigErrors(
  value: unknown,
  allowedRefs: ReadonlySet<string>,
): readonly NormalizedLiveUploadError[] {
  if (!Array.isArray(value)) {
    throw new TypeError("useLiveUpload config.errors must be an array");
  }

  return Object.freeze(
    value.map((error, index) => {
      const source = `useLiveUpload config.errors[${index}]`;
      if (!isRecord(error)) {
        throw new TypeError(`${source} must be an object`);
      }
      assertExactKeys(error, CONFIG_ERROR_KEYS, source);
      const ref = assertNonEmptyString(error.ref, `${source}.ref`);
      if (!allowedRefs.has(ref)) {
        throw new TypeError(`${source}.ref does not identify this upload`);
      }
      return Object.freeze({
        error: cloneEncodedValue(error.error, `${source}.error`),
        ref,
      });
    }),
  );
}

export function normalizeLiveUploadConfig(
  config: unknown,
): NormalizedLiveUploadConfig {
  if (!isRecord(config)) {
    throw new TypeError(
      "useLiveUpload requires an encoded Phoenix upload config object",
    );
  }
  assertExactKeys(config, CONFIG_KEYS, "useLiveUpload config");

  if (!Array.isArray(config.entries)) {
    throw new TypeError("useLiveUpload config.entries must be an array");
  }
  const entries = Object.freeze(
    config.entries.map((entry, index) =>
      normalizeEntry(entry, `useLiveUpload config.entries[${index}]`),
    ),
  );
  const refs = entries.map(({ ref }) => ref);
  if (new Set(refs).size !== refs.length) {
    throw new TypeError("useLiveUpload config.entries must have unique refs");
  }

  const maxEntriesMode = config.max_entries_mode;
  if (maxEntriesMode !== "selected" && maxEntriesMode !== "total") {
    throw new TypeError(
      'useLiveUpload config.max_entries_mode must be "selected" or "total"',
    );
  }
  const ref = assertNonEmptyString(config.ref, "useLiveUpload config.ref");
  const allowedErrorRefs = new Set([ref, ...refs]);

  return Object.freeze({
    accept: normalizeAccept(config.accept),
    auto_upload: assertBoolean(
      config.auto_upload,
      "useLiveUpload config.auto_upload",
    ),
    entries,
    errors: normalizeConfigErrors(config.errors, allowedErrorRefs),
    max_entries: assertSafeInteger(
      config.max_entries,
      "useLiveUpload config.max_entries",
      1,
    ),
    max_entries_mode: maxEntriesMode,
    max_file_size: assertSafeInteger(
      config.max_file_size,
      "useLiveUpload config.max_file_size",
      1,
    ),
    name: assertNonEmptyString(config.name, "useLiveUpload config.name"),
    ref,
  });
}

function isElement(value: unknown): value is HTMLElement {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ownerDocument" in value)
  ) {
    return false;
  }
  const ownerDocument = (value as { readonly ownerDocument?: Document })
    .ownerDocument;
  const ownerWindow = ownerDocument?.defaultView;
  return (
    ownerWindow !== null &&
    ownerWindow !== undefined &&
    value instanceof ownerWindow.HTMLElement
  );
}

function resolveTargetElement(
  target: LiveViewTarget | undefined,
  ownerDocument: Document,
  input: HTMLInputElement,
): HTMLElement | null {
  if (target === undefined) return null;
  if (typeof target === "number") {
    const selector = `[data-phx-component="${target}"]`;
    const component =
      input.closest<HTMLElement>(selector) ??
      input.form?.closest<HTMLElement>(selector);
    if (component === null || component === undefined) {
      throw new Error(
        `useLiveUpload input "${input.id}" is outside component target ${target}`,
      );
    }
    return component;
  }
  if (isElement(target)) {
    if (target.ownerDocument !== ownerDocument) {
      throw new Error("useLiveUpload target belongs to another document");
    }
    return target;
  }

  let elements: readonly Element[];
  try {
    elements = Array.from(ownerDocument.querySelectorAll(target));
  } catch (error) {
    throw new TypeError(
      `useLiveUpload target is not a valid selector: ${String(error)}`,
    );
  }
  if (elements.length === 0) {
    throw new Error(`useLiveUpload could not find target selector "${target}"`);
  }
  if (elements.length !== 1 || !isElement(elements[0])) {
    throw new Error(
      `useLiveUpload target selector "${target}" must match exactly one element`,
    );
  }
  const element = elements[0];
  return element;
}

function phoenixEvent(form: HTMLFormElement, kind: "change" | "submit") {
  const direct = form.getAttribute(`phx-${kind}`);
  const data = form.getAttribute(`data-phx-${kind}`);
  if (direct !== null && data !== null && direct !== data) {
    throw new Error(
      `useLiveUpload form has conflicting phx-${kind} attributes`,
    );
  }
  return direct ?? data;
}

function assertExpectedFormEvent(
  form: HTMLFormElement,
  kind: "change" | "submit",
  expected: string | undefined,
): void {
  if (expected === undefined) return;
  const actual = phoenixEvent(form, kind);
  if (actual !== expected) {
    throw new Error(
      `useLiveUpload expected form phx-${kind}="${expected}", got ${
        actual === null ? "no binding" : `"${actual}"`
      }`,
    );
  }
}

function uploadInputsInScope(
  ownerDocument: Document,
  scope: HTMLElement,
): readonly HTMLInputElement[] {
  return Array.from(
    ownerDocument.querySelectorAll<HTMLInputElement>(
      'input[type="file"][data-phx-upload-ref]',
    ),
  ).filter((candidate) => {
    if (scope instanceof ownerDocument.defaultView!.HTMLFormElement) {
      return candidate.form === scope;
    }
    return (
      (scope !== candidate && scope.contains(candidate)) ||
      (scope.id !== "" && candidate.getAttribute("form") === scope.id)
    );
  });
}

export function resolveLiveUploadInput(
  config: NormalizedLiveUploadConfig,
  options: ResolveLiveUploadInputOptions,
): ResolvedLiveUploadInput {
  const ownerDocument =
    options.bridgeElement?.ownerDocument ??
    (typeof document === "undefined" ? null : document);
  if (ownerDocument === null || ownerDocument.defaultView === null) {
    throw new Error("useLiveUpload requires a browser document");
  }

  const candidate = ownerDocument.getElementById(config.ref);
  if (
    !(candidate instanceof ownerDocument.defaultView.HTMLInputElement) ||
    candidate.type !== "file"
  ) {
    throw new Error(
      `useLiveUpload could not find a live_file_input with id "${config.ref}"`,
    );
  }
  if (candidate.getAttribute("data-phx-hook") !== "Phoenix.LiveFileUpload") {
    throw new Error(
      `useLiveUpload input "${config.ref}" is not rendered by <.live_file_input>`,
    );
  }
  if (candidate.getAttribute("data-phx-upload-ref") !== config.ref) {
    throw new Error(
      `useLiveUpload input "${config.ref}" has a mismatched upload ref`,
    );
  }
  if (candidate.name !== config.name) {
    throw new Error(
      `useLiveUpload input "${config.ref}" must have name "${config.name}"`,
    );
  }
  if (candidate.multiple !== config.max_entries > 1) {
    throw new Error(
      `useLiveUpload input "${config.ref}" has a multiple attribute inconsistent with max_entries`,
    );
  }
  const expectedAccept = config.accept === "any" ? "" : config.accept.join(",");
  if (candidate.accept !== expectedAccept) {
    throw new Error(
      `useLiveUpload input "${config.ref}" has an accept attribute inconsistent with config.accept`,
    );
  }
  if (candidate.hasAttribute("data-phx-auto-upload") !== config.auto_upload) {
    throw new Error(
      `useLiveUpload input "${config.ref}" has an auto-upload attribute inconsistent with config.auto_upload`,
    );
  }

  const form = candidate.form;
  if (form === null) {
    throw new Error(
      `useLiveUpload input "${config.ref}" must be associated with a form`,
    );
  }
  if (options.formId !== undefined && form.id !== options.formId) {
    throw new Error(
      `useLiveUpload input "${config.ref}" must be associated with form "${options.formId}"`,
    );
  }

  assertExpectedFormEvent(form, "change", options.changeEvent);
  assertExpectedFormEvent(form, "submit", options.submitEvent);
  if (config.auto_upload && phoenixEvent(form, "change") === null) {
    throw new Error(
      `useLiveUpload auto-upload input "${config.ref}" requires a form phx-change binding`,
    );
  }

  const explicitTarget = resolveTargetElement(
    options.target,
    ownerDocument,
    candidate,
  );
  const liveViewOwner =
    options.bridgeElement?.closest<HTMLElement>("[data-phx-session]");
  const scope = explicitTarget ?? liveViewOwner ?? form;
  const matchingInputs = uploadInputsInScope(ownerDocument, scope).filter(
    (input) => input.name === config.name,
  );
  if (!matchingInputs.includes(candidate)) {
    throw new Error(
      `useLiveUpload input "${config.ref}" is outside the upload target`,
    );
  }
  if (matchingInputs.length !== 1) {
    throw new Error(
      `useLiveUpload found duplicate live file inputs named "${config.name}"`,
    );
  }

  return Object.freeze({ form, input: candidate });
}

export function normalizeUploadFiles(
  files: UploadFiles | null | undefined,
): readonly File[] {
  if (files === null || files === undefined) return Object.freeze([]);
  if (typeof File === "undefined") {
    throw new Error("useLiveUpload addFiles requires a browser File API");
  }

  const normalized = Array.from(files);
  if (!normalized.every((file) => file instanceof File)) {
    throw new TypeError("useLiveUpload addFiles accepts only File objects");
  }
  return Object.freeze(normalized);
}
