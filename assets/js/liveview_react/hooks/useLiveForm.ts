import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  errorsAtLiveFormPath,
  formatPhoenixFieldName,
  getLiveFormValue,
  isLiveFormControlChecked,
  liveFormPathKey,
  liveFormValuesEqual,
  normalizeLiveFormControlValue,
  requiredAtLiveFormPath,
  setLiveFormValue,
  toLiveFormControlValue,
  validateLiveFormOptions,
  validateLiveFormPath,
  validateLiveFormServerSnapshot,
  type LiveFormErrors,
  type LiveFormControlChangeEvent,
  type LiveFormFieldBinding,
  type LiveFormFieldOptions,
  type LiveFormOptions,
  type LiveFormPath,
  type LiveFormProps,
  type LiveFormRequired,
  type LiveFormRevisionInputProps,
  type LiveFormServerSnapshot,
  type LiveFormValues,
} from "../forms";
import {
  addLiveFormPath,
  createInitialLiveFormState,
  createLiveFormValidationPayload,
  incrementLiveFormRevision,
  inspectLiveFormSubmitEvent,
  LiveFormSubmitCancelledError,
  LiveFormSubmitInvalidError,
  LIVE_FORM_SUBMIT_EVENT,
  reconcileLiveFormServerSnapshot,
  rejectLiveFormSubmit,
  removeLiveFormPath,
  settleLiveFormSubmitState,
  type ActiveLiveFormSubmit,
  type LiveFormHookConfig,
  type LiveFormState,
  type PendingLiveFormValidation,
} from "./live-form-runtime";
import { useLiveConnection } from "./useLiveConnection";
import { useLiveEvent } from "./useLiveEvent";
import { useLiveReact } from "./useLiveReact";

export {
  LiveFormSubmitCancelledError,
  LiveFormSubmitInvalidError,
} from "./live-form-runtime";

export interface UseLiveFormResult<
  TValues extends LiveFormValues,
  TSubmitReply = unknown,
> {
  readonly dirty: boolean;
  readonly errors: LiveFormErrors;
  readonly field: (
    path: LiveFormPath,
    options?: LiveFormFieldOptions,
  ) => LiveFormFieldBinding;
  readonly formProps: LiveFormProps;
  readonly id: string;
  readonly isDirty: (path: LiveFormPath) => boolean;
  readonly isRequired: (path: LiveFormPath, override?: boolean) => boolean;
  readonly isTouched: (path: LiveFormPath) => boolean;
  readonly name: string;
  readonly required: LiveFormRequired;
  readonly reset: () => void;
  readonly revision: number;
  readonly revisionInputProps: LiveFormRevisionInputProps;
  readonly setValue: (path: LiveFormPath, value: unknown) => void;
  readonly submit: () => Promise<TSubmitReply>;
  readonly submitError: unknown;
  readonly submitReply: TSubmitReply | undefined;
  readonly submitting: boolean;
  readonly touch: (path: LiveFormPath) => void;
  readonly touched: boolean;
  readonly valid: boolean;
  readonly validating: boolean;
  readonly validationError: unknown;
  readonly values: TValues;
}

export function useLiveForm<
  TValues extends LiveFormValues,
  TSubmitReply = unknown,
>(
  serverForm: LiveFormServerSnapshot<TValues>,
  options: LiveFormOptions,
): UseLiveFormResult<TValues, TSubmitReply> {
  const snapshot = useMemo(
    () => validateLiveFormServerSnapshot<TValues>(serverForm),
    [serverForm],
  );
  const validatedOptions = validateLiveFormOptions(options);
  const bridge = useLiveReact();
  const connection = useLiveConnection();
  const [state, setState] = useState<LiveFormState<TValues, TSubmitReply>>(() =>
    createInitialLiveFormState(snapshot),
  );
  const activeSubmitRef = useRef<ActiveLiveFormSubmit<TSubmitReply> | null>(
    null,
  );
  const awaitingValidationRef =
    useRef<PendingLiveFormValidation<TValues> | null>(null);
  const configRef = useRef<LiveFormHookConfig>({
    changeEvent: validatedOptions.changeEvent,
    debounce: validatedOptions.debounce,
    formName: snapshot.name,
    pushEvent: bridge.pushEvent,
  });
  const connectedRef = useRef(connection.connected);
  const formElementRef = useRef<HTMLFormElement | null>(null);
  const lastServerSnapshotRef = useRef(snapshot);
  const lastTargetRef = useRef<LiveFormPath | null>(null);
  const mountedRef = useRef(false);
  const pendingValidationRef =
    useRef<PendingLiveFormValidation<TValues> | null>(null);
  const previousConnectedRef = useRef(connection.connected);
  const stateRef = useRef(state);
  const validationGenerationRef = useRef(0);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  stateRef.current = state;
  const commitState = useCallback(
    (
      update: (
        current: LiveFormState<TValues, TSubmitReply>,
      ) => LiveFormState<TValues, TSubmitReply>,
    ): void => {
      const next = update(stateRef.current);
      stateRef.current = next;
      if (mountedRef.current) setState(next);
    },
    [],
  );
  const clearValidationTimer = useCallback((): void => {
    if (validationTimerRef.current === null) return;
    clearTimeout(validationTimerRef.current);
    validationTimerRef.current = null;
  }, []);
  const cancelActiveSubmit = useCallback(
    (reason: unknown, updateState: boolean): void => {
      const active = activeSubmitRef.current;
      if (active === null) return;

      activeSubmitRef.current = null;
      active.reject?.(reason);
      if (updateState) {
        commitState((current) =>
          Object.freeze({
            ...current,
            submitError: reason,
            submitting: false,
          }),
        );
      }
    },
    [commitState],
  );
  const failValidation = useCallback(
    (pending: PendingLiveFormValidation<TValues>, error: unknown): void => {
      if (pending.generation !== validationGenerationRef.current) return;
      if (stateRef.current.revision !== pending.revision) return;
      if (awaitingValidationRef.current?.generation !== pending.generation) {
        return;
      }

      awaitingValidationRef.current = null;
      commitState((current) =>
        Object.freeze({
          ...current,
          validating: false,
          validationError: error,
        }),
      );
    },
    [commitState],
  );

  const launchValidation = useCallback(
    (pending: PendingLiveFormValidation<TValues>): void => {
      if (!mountedRef.current || !connectedRef.current) {
        pendingValidationRef.current = pending;
        return;
      }

      pendingValidationRef.current = null;
      awaitingValidationRef.current = pending;
      let pushed: unknown;
      try {
        pushed = configRef.current.pushEvent(
          configRef.current.changeEvent,
          createLiveFormValidationPayload(configRef.current.formName, pending),
        );
      } catch (reason: unknown) {
        failValidation(pending, reason);
        return;
      }

      if (
        (typeof pushed !== "object" && typeof pushed !== "function") ||
        pushed === null ||
        !("then" in pushed) ||
        typeof pushed.then !== "function"
      ) {
        failValidation(
          pending,
          new TypeError("LiveView pushEvent must return a Promise"),
        );
        return;
      }

      Promise.resolve(pushed).then(
        () => undefined,
        (reason: unknown) => failValidation(pending, reason),
      );
    },
    [failValidation],
  );

  const scheduleValidation = useCallback(
    (
      values: TValues,
      revision: number,
      path: LiveFormPath,
      delay = configRef.current.debounce,
    ): void => {
      clearValidationTimer();
      const pending = Object.freeze({
        generation: ++validationGenerationRef.current,
        path,
        revision,
        values,
      });
      awaitingValidationRef.current = null;
      pendingValidationRef.current = pending;

      if (!connectedRef.current) {
        commitState((current) =>
          Object.freeze({
            ...current,
            validating: false,
          }),
        );
        return;
      }

      commitState((current) =>
        Object.freeze({
          ...current,
          validating: true,
          validationError: null,
        }),
      );
      validationTimerRef.current = setTimeout(() => {
        validationTimerRef.current = null;
        if (pendingValidationRef.current?.generation !== pending.generation) {
          return;
        }
        launchValidation(pending);
      }, delay);
    },
    [clearValidationTimer, commitState, launchValidation],
  );

  const setValue = useCallback(
    (path: LiveFormPath, value: unknown): void => {
      if (!mountedRef.current) {
        throw new Error("Cannot update a live form after it unmounted");
      }

      const validatedPath = validateLiveFormPath(path);
      const current = stateRef.current;
      const values = setLiveFormValue(current.values, validatedPath, value);
      if (values === current.values) return;

      const revision = incrementLiveFormRevision(current.revision);
      const pathKey = liveFormPathKey(validatedPath);
      const isDirty = !liveFormValuesEqual(
        getLiveFormValue(values, validatedPath),
        getLiveFormValue(current.baseline, validatedPath),
      );
      const dirtyPaths = isDirty
        ? addLiveFormPath(current.dirtyPaths, pathKey)
        : removeLiveFormPath(current.dirtyPaths, pathKey);
      lastTargetRef.current = validatedPath;
      commitState(() =>
        Object.freeze({
          ...current,
          dirtyPaths,
          revision,
          values,
        }),
      );
      scheduleValidation(values, revision, validatedPath);
    },
    [commitState, scheduleValidation],
  );

  const touch = useCallback(
    (path: LiveFormPath): void => {
      const pathKey = liveFormPathKey(path);
      commitState((current) => {
        const touchedPaths = addLiveFormPath(current.touchedPaths, pathKey);
        return touchedPaths === current.touchedPaths
          ? current
          : Object.freeze({ ...current, touchedPaths });
      });
    },
    [commitState],
  );

  const isDirty = useCallback(
    (path: LiveFormPath): boolean =>
      stateRef.current.dirtyPaths.includes(liveFormPathKey(path)),
    [],
  );

  const isTouched = useCallback(
    (path: LiveFormPath): boolean =>
      stateRef.current.touchedPaths.includes(liveFormPathKey(path)),
    [],
  );

  const isRequired = useCallback(
    (path: LiveFormPath, override?: boolean): boolean =>
      override ?? requiredAtLiveFormPath(stateRef.current.required, path),
    [],
  );

  const reset = useCallback((): void => {
    clearValidationTimer();
    awaitingValidationRef.current = null;
    pendingValidationRef.current = null;
    validationGenerationRef.current += 1;
    cancelActiveSubmit(
      new LiveFormSubmitCancelledError(
        "Live form submission was cancelled by reset",
      ),
      false,
    );
    const next = createInitialLiveFormState(lastServerSnapshotRef.current);
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, [cancelActiveSubmit, clearValidationTimer]);

  const startNativeSubmit = useCallback((): void => {
    const current = stateRef.current;
    const active = activeSubmitRef.current;
    if (active !== null && active.started) return;
    const currentServer = lastServerSnapshotRef.current;

    activeSubmitRef.current = Object.freeze({
      formId: currentServer.id,
      formName: currentServer.name,
      promise: active?.promise ?? null,
      reject: active?.reject ?? null,
      resolve: active?.resolve ?? null,
      revision: current.revision,
      started: true,
    });
    commitState((latest) =>
      Object.freeze({
        ...latest,
        submitError: null,
        submitReply: undefined,
        submitting: true,
      }),
    );
  }, [commitState]);

  const onSubmit = useCallback(
    (_event: FormEvent<HTMLFormElement>): void => {
      startNativeSubmit();
    },
    [startNativeSubmit],
  );

  const submit = useCallback((): Promise<TSubmitReply> => {
    const form = formElementRef.current;
    if (form === null) {
      return rejectLiveFormSubmit<TSubmitReply>(
        new LiveFormSubmitCancelledError(
          "Cannot submit a live form before its formProps ref is mounted",
        ),
      );
    }
    if (!connectedRef.current) {
      return rejectLiveFormSubmit<TSubmitReply>(
        new LiveFormSubmitCancelledError(
          "Cannot submit a live form while LiveView is disconnected",
        ),
      );
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return rejectLiveFormSubmit<TSubmitReply>(
        new LiveFormSubmitInvalidError(),
      );
    }

    const existing = activeSubmitRef.current;
    if (existing?.promise !== null && existing?.promise !== undefined) {
      return existing.promise;
    }

    let reject!: (reason: unknown) => void;
    let resolve!: (reply: TSubmitReply) => void;
    const promise = new Promise<TSubmitReply>(
      (promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
      },
    );
    void promise.catch(() => undefined);
    const currentServer = lastServerSnapshotRef.current;
    activeSubmitRef.current = Object.freeze({
      formId: currentServer.id,
      formName: currentServer.name,
      promise,
      reject,
      resolve,
      revision: stateRef.current.revision,
      started: true,
    });

    commitState((current) =>
      Object.freeze({
        ...current,
        submitError: null,
        submitReply: undefined,
        submitting: true,
      }),
    );

    if (existing?.started !== true) {
      try {
        form.requestSubmit();
      } catch (reason: unknown) {
        cancelActiveSubmit(reason, true);
      }
    }

    return promise;
  }, [cancelActiveSubmit]);

  const receiveSubmitEvent = useCallback(
    (payload: unknown): void => {
      const result = inspectLiveFormSubmitEvent(
        activeSubmitRef.current,
        payload,
      );
      if (!result.ok) {
        cancelActiveSubmit(result.error, true);
        return;
      }
      const { settlement } = result;
      if (settlement === null) return;

      activeSubmitRef.current = null;
      settlement.active.resolve?.(settlement.reply);
      commitState((current) =>
        settleLiveFormSubmitState(current, settlement.reply),
      );
    },
    [cancelActiveSubmit, commitState],
  );
  useLiveEvent<unknown>(LIVE_FORM_SUBMIT_EVENT, receiveSubmitEvent);

  const formRef = useCallback((form: HTMLFormElement | null): void => {
    formElementRef.current = form;
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearValidationTimer();
      awaitingValidationRef.current = null;
      pendingValidationRef.current = null;
      validationGenerationRef.current += 1;
      cancelActiveSubmit(
        new LiveFormSubmitCancelledError(
          "Live form submission was cancelled because the component unmounted",
        ),
        false,
      );
    };
  }, [cancelActiveSubmit, clearValidationTimer]);

  useLayoutEffect(() => {
    configRef.current = {
      changeEvent: validatedOptions.changeEvent,
      debounce: validatedOptions.debounce,
      formName: snapshot.name,
      pushEvent: bridge.pushEvent,
    };
  }, [
    bridge.pushEvent,
    snapshot.name,
    validatedOptions.changeEvent,
    validatedOptions.debounce,
  ]);

  useEffect(() => {
    if (lastServerSnapshotRef.current === snapshot) return;

    const previousServer = lastServerSnapshotRef.current;
    const changedForm =
      snapshot.id !== previousServer.id ||
      snapshot.name !== previousServer.name;
    const acceptingReconnectSnapshot =
      !connection.connected || !previousConnectedRef.current;
    const staleSnapshot =
      !changedForm &&
      snapshot.revision < stateRef.current.revision &&
      !acceptingReconnectSnapshot;
    const pendingValidation =
      pendingValidationRef.current ?? awaitingValidationRef.current;
    const acknowledgesValidation =
      !changedForm &&
      !staleSnapshot &&
      pendingValidation !== null &&
      pendingValidation.generation === validationGenerationRef.current &&
      snapshot.id === previousServer.id &&
      snapshot.name === previousServer.name &&
      snapshot.revision >= pendingValidation.revision;
    if (changedForm || acknowledgesValidation) {
      clearValidationTimer();
      awaitingValidationRef.current = null;
      pendingValidationRef.current = null;
      if (changedForm) validationGenerationRef.current += 1;
    }
    if (!staleSnapshot) lastServerSnapshotRef.current = snapshot;
    if (changedForm && activeSubmitRef.current !== null) {
      cancelActiveSubmit(
        new LiveFormSubmitCancelledError(
          "Live form submission was cancelled because the server replaced the form",
        ),
        true,
      );
    }

    commitState((current) =>
      reconcileLiveFormServerSnapshot(current, snapshot, {
        acknowledgesValidation,
        changedForm,
        staleSnapshot,
      }),
    );
  }, [
    cancelActiveSubmit,
    clearValidationTimer,
    commitState,
    connection.connected,
    snapshot,
  ]);

  useEffect(() => {
    const wasConnected = previousConnectedRef.current;
    previousConnectedRef.current = connection.connected;
    connectedRef.current = connection.connected;
    if (wasConnected === connection.connected) return;

    if (!connection.connected) {
      clearValidationTimer();
      awaitingValidationRef.current = null;
      validationGenerationRef.current += 1;
      if (stateRef.current.dirtyPaths.length > 0 && lastTargetRef.current) {
        pendingValidationRef.current = Object.freeze({
          generation: validationGenerationRef.current,
          path: lastTargetRef.current,
          revision: stateRef.current.revision,
          values: stateRef.current.values,
        });
      }
      commitState((current) =>
        Object.freeze({ ...current, validating: false }),
      );
      cancelActiveSubmit(
        new LiveFormSubmitCancelledError(
          "Live form submission was cancelled because LiveView disconnected",
        ),
        true,
      );
      return;
    }

    if (stateRef.current.dirtyPaths.length > 0 && lastTargetRef.current) {
      scheduleValidation(
        stateRef.current.values,
        stateRef.current.revision,
        lastTargetRef.current,
        0,
      );
    }
  }, [
    cancelActiveSubmit,
    clearValidationTimer,
    commitState,
    connection.connected,
    scheduleValidation,
  ]);

  const field = useCallback(
    (
      path: LiveFormPath,
      fieldOptions: LiveFormFieldOptions = {},
    ): LiveFormFieldBinding => {
      const validatedPath = validateLiveFormPath(path);
      const pathKey = liveFormPathKey(validatedPath);
      const value = getLiveFormValue(state.values, validatedPath);
      const errors = errorsAtLiveFormPath(state.errors, validatedPath);
      const touched = state.touchedPaths.includes(pathKey);
      const dirty = state.dirtyPaths.includes(pathKey);
      const required =
        fieldOptions.required ??
        requiredAtLiveFormPath(state.required, validatedPath);
      const checked = isLiveFormControlChecked(value, fieldOptions);
      const type = fieldOptions.type?.toLowerCase();
      const baseName = formatPhoenixFieldName(snapshot.name, validatedPath);
      const name = fieldOptions.multiple ? `${baseName}[]` : baseName;
      const renderedValue =
        type === "checkbox"
          ? String(fieldOptions.value ?? fieldOptions.checkedValue ?? true)
          : type === "radio"
            ? (fieldOptions.value ?? "")
            : toLiveFormControlValue(value);
      const inputProps = {
        "aria-invalid": errors.length > 0,
        "aria-required": required,
        name,
        onBlur(): void {
          touch(validatedPath);
        },
        onChange(event: LiveFormControlChangeEvent): void {
          event.nativeEvent.stopPropagation();
          const currentValue = getLiveFormValue(
            stateRef.current.values,
            validatedPath,
          );
          setValue(
            validatedPath,
            normalizeLiveFormControlValue(
              event.currentTarget,
              currentValue,
              fieldOptions,
            ),
          );
        },
        required,
        value: renderedValue,
      };

      return Object.freeze({
        dirty,
        displayErrors: touched ? errors : Object.freeze([]),
        errors,
        ...(type === "checkbox" && !fieldOptions.multiple
          ? {
              hiddenInputProps: Object.freeze({
                name,
                type: "hidden" as const,
                value: String(fieldOptions.uncheckedValue ?? false),
              }),
            }
          : {}),
        inputProps: Object.freeze({
          ...inputProps,
          ...(checked === undefined ? {} : { checked }),
          ...(fieldOptions.type === undefined
            ? {}
            : { type: fieldOptions.type }),
        }),
        required,
        touched,
      });
    },
    [setValue, snapshot.name, state, touch],
  );

  const formProps = useMemo<LiveFormProps>(
    () =>
      Object.freeze({
        id: snapshot.id,
        onSubmit,
        "phx-auto-recover": "ignore",
        "phx-change": validatedOptions.changeEvent,
        "phx-submit": validatedOptions.submitEvent,
        ref: formRef,
      }),
    [
      formRef,
      onSubmit,
      snapshot.id,
      validatedOptions.changeEvent,
      validatedOptions.submitEvent,
    ],
  );
  const revisionInputProps = useMemo<LiveFormRevisionInputProps>(
    () =>
      Object.freeze({
        name: "_liveview_react_revision",
        type: "hidden",
        value: String(state.revision),
      }),
    [state.revision],
  );

  return Object.freeze({
    dirty: state.dirtyPaths.length > 0,
    errors: state.errors,
    field,
    formProps,
    id: snapshot.id,
    isDirty,
    isRequired,
    isTouched,
    name: snapshot.name,
    required: state.required,
    reset,
    revision: state.revision,
    revisionInputProps,
    setValue,
    submit,
    submitError: state.submitError,
    submitReply: state.submitReply,
    submitting: state.submitting,
    touch,
    touched: state.touchedPaths.length > 0,
    valid: state.valid,
    validating: state.validating,
    validationError: state.validationError,
    values: state.values,
  });
}
