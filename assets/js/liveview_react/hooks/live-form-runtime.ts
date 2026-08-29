import {
  validateLiveFormSubmitEvent,
  type LiveFormErrors,
  type LiveFormPath,
  type LiveFormRequired,
  type LiveFormServerSnapshot,
  type LiveFormSubmitEvent,
  type LiveFormValues,
} from "../forms";
/*
 * Event payload validation lives beside the wire validators, while this module
 * owns the submit lane correlation policy.
 */
import type { EventPayload, PushEvent } from "../types";

export const LIVE_FORM_SUBMIT_EVENT = "liveview_react:form_submit";

export class LiveFormSubmitCancelledError extends Error {
  constructor(message = "Live form submission was cancelled") {
    super(message);
    this.name = "LiveFormSubmitCancelledError";
  }
}

export class LiveFormSubmitInvalidError extends Error {
  constructor() {
    super("Live form submission was blocked by native form validation");
    this.name = "LiveFormSubmitInvalidError";
  }
}

export interface LiveFormState<TValues extends LiveFormValues, TSubmitReply> {
  readonly baseline: TValues;
  readonly dirtyPaths: readonly string[];
  readonly errors: LiveFormErrors;
  readonly required: LiveFormRequired;
  readonly revision: number;
  readonly submitError: unknown;
  readonly submitReply: TSubmitReply | undefined;
  readonly submitting: boolean;
  readonly touchedPaths: readonly string[];
  readonly valid: boolean;
  readonly validating: boolean;
  readonly validationError: unknown;
  readonly values: TValues;
}

export interface PendingLiveFormValidation<TValues extends LiveFormValues> {
  readonly generation: number;
  readonly path: LiveFormPath;
  readonly revision: number;
  readonly values: TValues;
}

export interface ActiveLiveFormSubmit<TSubmitReply> {
  readonly formId: string;
  readonly formName: string;
  readonly promise: Promise<TSubmitReply> | null;
  readonly reject: ((reason: unknown) => void) | null;
  readonly resolve: ((reply: TSubmitReply) => void) | null;
  readonly revision: number;
  readonly started: boolean;
}

export interface LiveFormSubmitSettlement<TSubmitReply> {
  readonly active: ActiveLiveFormSubmit<TSubmitReply>;
  readonly reply: TSubmitReply;
}

export interface LiveFormServerReconciliation {
  readonly acknowledgesValidation: boolean;
  readonly changedForm: boolean;
  readonly staleSnapshot: boolean;
}

export interface LiveFormHookConfig {
  readonly changeEvent: string;
  readonly debounce: number;
  readonly formName: string;
  readonly pushEvent: PushEvent;
}

export function createInitialLiveFormState<TValues extends LiveFormValues>(
  snapshot: LiveFormServerSnapshot<TValues>,
): LiveFormState<TValues, never> {
  return Object.freeze({
    baseline: snapshot.values,
    dirtyPaths: Object.freeze([]),
    errors: snapshot.errors,
    required: snapshot.required,
    revision: snapshot.revision,
    submitError: null,
    submitReply: undefined,
    submitting: false,
    touchedPaths: Object.freeze([]),
    valid: snapshot.valid,
    validating: false,
    validationError: null,
    values: snapshot.values,
  });
}

export function matchLiveFormSubmitEvent<TSubmitReply>(
  active: ActiveLiveFormSubmit<TSubmitReply> | null,
  event: LiveFormSubmitEvent<TSubmitReply>,
): LiveFormSubmitSettlement<TSubmitReply> | null {
  if (
    active === null ||
    !active.started ||
    event.id !== active.formId ||
    event.name !== active.formName ||
    event.revision < active.revision
  ) {
    return null;
  }

  return Object.freeze({ active, reply: event.reply });
}

export type LiveFormSubmitEventInspection<TSubmitReply> =
  | Readonly<{
      ok: true;
      settlement: LiveFormSubmitSettlement<TSubmitReply> | null;
    }>
  | Readonly<{ error: unknown; ok: false }>;

function targetsActiveLiveFormSubmit<TSubmitReply>(
  active: ActiveLiveFormSubmit<TSubmitReply>,
  payload: unknown,
): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "id" in payload &&
    "name" in payload &&
    payload.id === active.formId &&
    payload.name === active.formName
  );
}

export function inspectLiveFormSubmitEvent<TSubmitReply>(
  active: ActiveLiveFormSubmit<TSubmitReply> | null,
  payload: unknown,
): LiveFormSubmitEventInspection<TSubmitReply> {
  if (active === null) return Object.freeze({ ok: true, settlement: null });

  try {
    if (!targetsActiveLiveFormSubmit(active, payload)) {
      return Object.freeze({ ok: true, settlement: null });
    }
    const event = validateLiveFormSubmitEvent<TSubmitReply>(payload);
    return Object.freeze({
      ok: true,
      settlement: matchLiveFormSubmitEvent(active, event),
    });
  } catch (error: unknown) {
    return Object.freeze({ error, ok: false });
  }
}

export function settleLiveFormSubmitState<
  TValues extends LiveFormValues,
  TSubmitReply,
>(
  state: LiveFormState<TValues, TSubmitReply>,
  reply: TSubmitReply,
): LiveFormState<TValues, TSubmitReply> {
  return Object.freeze({
    ...state,
    submitError: null,
    submitReply: reply,
    submitting: false,
  });
}

export function reconcileLiveFormServerSnapshot<
  TValues extends LiveFormValues,
  TSubmitReply,
>(
  state: LiveFormState<TValues, TSubmitReply>,
  snapshot: LiveFormServerSnapshot<TValues>,
  reconciliation: LiveFormServerReconciliation,
): LiveFormState<TValues, TSubmitReply> {
  if (reconciliation.changedForm) return createInitialLiveFormState(snapshot);
  if (reconciliation.staleSnapshot) return state;

  const validationState = reconciliation.acknowledgesValidation
    ? { validating: false, validationError: null }
    : {};
  if (state.dirtyPaths.length === 0) {
    return Object.freeze({
      ...state,
      baseline: snapshot.values,
      dirtyPaths: Object.freeze([]),
      errors: snapshot.errors,
      required: snapshot.required,
      revision: snapshot.revision,
      touchedPaths: Object.freeze([]),
      valid: snapshot.valid,
      ...validationState,
      values: snapshot.values,
    });
  }

  return Object.freeze({
    ...state,
    errors: snapshot.errors,
    required: snapshot.required,
    revision: Math.max(state.revision, snapshot.revision),
    valid: snapshot.valid,
    ...validationState,
  });
}

export function addLiveFormPath(
  paths: readonly string[],
  path: string,
): readonly string[] {
  return paths.includes(path) ? paths : Object.freeze([...paths, path]);
}

export function removeLiveFormPath(
  paths: readonly string[],
  path: string,
): readonly string[] {
  return paths.includes(path)
    ? Object.freeze(paths.filter((entry) => entry !== path))
    : paths;
}

export function incrementLiveFormRevision(revision: number): number {
  if (revision === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Live form revision exceeded Number.MAX_SAFE_INTEGER");
  }
  return revision + 1;
}

export function createLiveFormValidationPayload<TValues extends LiveFormValues>(
  formName: string,
  pending: PendingLiveFormValidation<TValues>,
): EventPayload {
  return Object.freeze({
    [formName]: pending.values,
    _liveview_react_revision: pending.revision,
    _target: Object.freeze([
      formName,
      ...pending.path.map((segment) => String(segment)),
    ]),
  });
}

export function rejectLiveFormSubmit<TSubmitReply>(
  reason: unknown,
): Promise<TSubmitReply> {
  const promise = Promise.reject<TSubmitReply>(reason);
  void promise.catch(() => undefined);
  return promise;
}
