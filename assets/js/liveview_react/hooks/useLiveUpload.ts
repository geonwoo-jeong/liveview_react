import type { DragEvent } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useRequiredClientBridge } from "../runtime/client-bridge-context";
import type {
  EventPayload,
  LiveUploadConfig,
  LiveUploadEntry,
  LiveViewTarget,
  UploadFiles,
} from "../types";
import {
  normalizeLiveUploadConfig,
  normalizeUploadFiles,
  resolveLiveUploadInput,
  type NormalizedLiveUploadConfig,
  type NormalizedLiveUploadEntry,
} from "../uploads";
import { useLiveConnection } from "./useLiveConnection";

const EMPTY_SELECTIONS: readonly LiveUploadSelection[] = Object.freeze([]);

export interface UseLiveUploadOptions {
  readonly cancelEvent?: string;
  readonly changeEvent?: string;
  readonly formId?: string;
  readonly submitEvent?: string;
  readonly target?: LiveViewTarget;
}

export type LiveUploadSelectionStatus = "interrupted" | "selected";

export interface LiveUploadSelection {
  readonly entryRef: string | null;
  readonly file: File;
  readonly key: string;
  readonly status: LiveUploadSelectionStatus;
  readonly uploadConfigRef: string;
}

export interface LiveUploadDropTargetProps {
  readonly "phx-drop-target": string;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface UseLiveUploadResult {
  readonly accept: "any" | readonly string[];
  readonly acceptAttribute: string | undefined;
  readonly addFiles: (files: UploadFiles | null | undefined) => void;
  readonly autoUpload: boolean;
  readonly cancel: (
    entryRef: string,
    payload?: EventPayload,
  ) => Promise<unknown>;
  readonly cancelAll: (payload?: EventPayload) => Promise<readonly unknown[]>;
  readonly connected: boolean;
  readonly dropTargetProps: LiveUploadDropTargetProps;
  readonly entries: readonly LiveUploadEntry[];
  readonly errors: readonly unknown[];
  readonly formErrors: readonly unknown[];
  readonly inputId: string;
  readonly isUploading: boolean;
  readonly maxEntries: number;
  readonly maxEntriesMode: "selected" | "total";
  readonly maxFileSize: number;
  readonly multiple: boolean;
  readonly name: string;
  readonly openFileDialog: () => void;
  readonly reconnecting: boolean;
  readonly retryInterrupted: () => void;
  readonly selections: readonly LiveUploadSelection[];
  readonly submit: () => void;
}

interface NormalizedOptions {
  readonly cancelEvent?: string;
  readonly changeEvent?: string;
  readonly formId?: string;
  readonly submitEvent?: string;
  readonly target?: LiveViewTarget;
}

function optionalNonEmptyString(
  value: string | undefined,
  source: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`useLiveUpload ${source} must be a non-empty string`);
  }
  return value;
}

function normalizeTarget(
  target: LiveViewTarget | undefined,
): LiveViewTarget | undefined {
  if (target === undefined) return undefined;
  if (typeof target === "string") {
    if (target.length === 0 || target.trim() !== target) {
      throw new TypeError("useLiveUpload target must be a non-empty selector");
    }
    return target;
  }
  if (typeof target === "number") {
    if (!Number.isSafeInteger(target) || target < 0) {
      throw new TypeError(
        "useLiveUpload numeric target must be a non-negative safe integer",
      );
    }
    return target;
  }
  const targetDocument = (target as { readonly ownerDocument?: Document })
    .ownerDocument;
  const targetWindow = targetDocument?.defaultView;
  if (
    targetWindow === null ||
    targetWindow === undefined ||
    !(target instanceof targetWindow.HTMLElement)
  ) {
    throw new TypeError(
      "useLiveUpload target must be a selector, component id, or HTMLElement",
    );
  }
  return target;
}

function normalizeOptions(options: UseLiveUploadOptions): NormalizedOptions {
  const cancelEvent = optionalNonEmptyString(
    options.cancelEvent,
    "cancelEvent",
  );
  const changeEvent = optionalNonEmptyString(
    options.changeEvent,
    "changeEvent",
  );
  const formId = optionalNonEmptyString(options.formId, "formId");
  const submitEvent = optionalNonEmptyString(
    options.submitEvent,
    "submitEvent",
  );
  const target = normalizeTarget(options.target);

  return Object.freeze({
    ...(cancelEvent === undefined ? {} : { cancelEvent }),
    ...(changeEvent === undefined ? {} : { changeEvent }),
    ...(formId === undefined ? {} : { formId }),
    ...(submitEvent === undefined ? {} : { submitEvent }),
    ...(target === undefined ? {} : { target }),
  });
}

function sameFiles(left: File, right: File): boolean {
  return Object.is(left, right);
}

function uniqueFiles(files: readonly File[]): readonly File[] {
  return files.filter(
    (file, index) =>
      files.findIndex((candidate) => sameFiles(candidate, file)) === index,
  );
}

function assertSelectionCapacity(
  config: NormalizedLiveUploadConfig,
  selections: readonly LiveUploadSelection[],
  files: readonly File[],
): void {
  const batch = uniqueFiles(files);
  if (batch.length === 0) return;
  if (config.max_entries === 1) {
    if (batch.length === 1) return;
    throw new Error("useLiveUpload selection exceeds max_entries (1)");
  }

  // Terminal entries release client-visible capacity. Phoenix remains authoritative
  // for consumed entries in `total` mode because that internal count is not on the wire.
  const activeEntryCount = config.entries.filter(
    ({ cancelled, done }) => !cancelled && !done,
  ).length;
  const pendingSelections = selections.filter(
    (selection) =>
      selection.uploadConfigRef === config.ref &&
      selection.status === "selected" &&
      selection.entryRef === null,
  );
  const newFileCount = batch.filter(
    (file) =>
      !pendingSelections.some((selection) => sameFiles(selection.file, file)),
  ).length;

  if (
    activeEntryCount + pendingSelections.length + newFileCount >
    config.max_entries
  ) {
    throw new Error(
      `useLiveUpload selection exceeds max_entries (${config.max_entries})`,
    );
  }
}

function interruptSelections(
  selections: readonly LiveUploadSelection[],
): readonly LiveUploadSelection[] {
  let changed = false;
  const interrupted = selections.map((selection) => {
    if (selection.status === "interrupted") return selection;
    changed = true;
    return Object.freeze({ ...selection, status: "interrupted" as const });
  });
  return changed ? Object.freeze(interrupted) : selections;
}

function interruptForNewConfig(
  selections: readonly LiveUploadSelection[],
): readonly LiveUploadSelection[] {
  if (selections.length === 0) return selections;
  return Object.freeze(
    selections.map((selection) =>
      Object.freeze({
        ...selection,
        entryRef: null,
        status: "interrupted" as const,
      }),
    ),
  );
}

function fileRelativePath(file: File): string {
  return "webkitRelativePath" in file &&
    typeof file.webkitRelativePath === "string"
    ? file.webkitRelativePath
    : "";
}

function cloneFileForRetry(file: File): File {
  const clone = new File([file], file.name, {
    lastModified: file.lastModified,
    type: file.type,
  });
  const relativePath = fileRelativePath(file);
  if (relativePath !== "") {
    Object.defineProperty(clone, "webkitRelativePath", {
      configurable: false,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
  }
  return clone;
}

function fileMatchesEntry(
  file: File,
  entry: NormalizedLiveUploadEntry,
): boolean {
  return (
    file.name === entry.client_name &&
    file.size === entry.client_size &&
    file.type === entry.client_type &&
    file.lastModified === entry.client_last_modified &&
    fileRelativePath(file) === entry.client_relative_path
  );
}

function reconcileSelections(
  selections: readonly LiveUploadSelection[],
  entries: readonly NormalizedLiveUploadEntry[],
  configRef: string,
): readonly LiveUploadSelection[] {
  const entriesByRef = new Map(entries.map((entry) => [entry.ref, entry]));
  const claimedRefs = new Set(
    selections.flatMap((selection) =>
      selection.uploadConfigRef === configRef && selection.entryRef !== null
        ? [selection.entryRef]
        : [],
    ),
  );
  let changed = false;
  const next: LiveUploadSelection[] = [];

  for (const selection of selections) {
    if (selection.uploadConfigRef !== configRef) {
      next.push(selection);
      continue;
    }

    if (selection.entryRef !== null) {
      const entry = entriesByRef.get(selection.entryRef);
      if (entry === undefined || entry.done || entry.cancelled) {
        changed = true;
        continue;
      }
      claimedRefs.add(entry.ref);
      next.push(selection);
      continue;
    }

    const entry = entries.find(
      (candidate) =>
        !claimedRefs.has(candidate.ref) &&
        fileMatchesEntry(selection.file, candidate),
    );
    if (entry === undefined) {
      next.push(selection);
      continue;
    }
    claimedRefs.add(entry.ref);
    changed = true;
    if (entry.done || entry.cancelled) continue;
    next.push(Object.freeze({ ...selection, entryRef: entry.ref }));
  }

  return changed ? Object.freeze(next) : selections;
}

export function useLiveUpload(
  config: LiveUploadConfig,
  options: UseLiveUploadOptions = {},
): UseLiveUploadResult {
  const bridge = useRequiredClientBridge("useLiveUpload");
  const connection = useLiveConnection();
  const normalizedConfig = useMemo(
    () => normalizeLiveUploadConfig(config),
    [config],
  );
  const normalizedOptions = useMemo(
    () => normalizeOptions(options),
    [
      options.cancelEvent,
      options.changeEvent,
      options.formId,
      options.submitEvent,
      options.target,
    ],
  );
  const [selections, setSelections] = useState(EMPTY_SELECTIONS);
  const selectionsRef = useRef(selections);
  const nextSelectionKey = useRef(0);
  const connectedRef = useRef(connection.connected);
  const previousConnection = useRef(connection.connected);
  const previousConfigRef = useRef(normalizedConfig.ref);
  const mounted = useRef(false);

  connectedRef.current = connection.connected;

  const replaceSelections = useCallback(
    (
      update: (
        current: readonly LiveUploadSelection[],
      ) => readonly LiveUploadSelection[],
    ): void => {
      const next = update(selectionsRef.current);
      selectionsRef.current = next;
      setSelections(next);
    },
    [],
  );

  const rememberFiles = useCallback(
    (
      files: readonly File[],
      status: LiveUploadSelectionStatus,
      uploadConfigRef: string,
    ): void => {
      if (files.length === 0) return;

      assertSelectionCapacity(normalizedConfig, selectionsRef.current, files);

      replaceSelections((current) => {
        const base = normalizedConfig.max_entries > 1 ? current : [];
        const next = [...base];
        for (const file of files) {
          const index = next.findIndex((selection) =>
            sameFiles(selection.file, file),
          );
          if (index >= 0) {
            const existing = next[index];
            if (
              existing !== undefined &&
              (existing.status !== status ||
                existing.uploadConfigRef !== uploadConfigRef)
            ) {
              next[index] = Object.freeze({
                ...existing,
                entryRef:
                  existing.uploadConfigRef === uploadConfigRef
                    ? existing.entryRef
                    : null,
                status,
                uploadConfigRef,
              });
            }
            continue;
          }

          next.push(
            Object.freeze({
              entryRef: null,
              file,
              key: `liveview-react-upload-${nextSelectionKey.current++}`,
              status,
              uploadConfigRef,
            }),
          );
        }
        return Object.freeze(next);
      });
    },
    [normalizedConfig, replaceSelections],
  );

  const resolveInput = useCallback(
    () =>
      resolveLiveUploadInput(normalizedConfig, {
        bridgeElement: bridge.el,
        ...(normalizedOptions.changeEvent === undefined
          ? {}
          : { changeEvent: normalizedOptions.changeEvent }),
        ...(normalizedOptions.formId === undefined
          ? {}
          : { formId: normalizedOptions.formId }),
        ...(normalizedOptions.submitEvent === undefined
          ? {}
          : { submitEvent: normalizedOptions.submitEvent }),
        ...(normalizedOptions.target === undefined
          ? {}
          : { target: normalizedOptions.target }),
      }),
    [bridge.el, normalizedConfig, normalizedOptions],
  );

  useLayoutEffect(() => {
    mounted.current = true;
    const { input } = resolveInput();
    const captureInputFiles = (): void => {
      const files = normalizeUploadFiles(input.files);
      rememberFiles(
        files,
        connectedRef.current ? "selected" : "interrupted",
        normalizedConfig.ref,
      );
    };
    input.addEventListener("input", captureInputFiles);

    return () => {
      mounted.current = false;
      input.removeEventListener("input", captureInputFiles);
    };
  }, [normalizedConfig.ref, rememberFiles, resolveInput]);

  useLayoutEffect(() => {
    const wasConnected = previousConnection.current;
    previousConnection.current = connection.connected;
    if (wasConnected && !connection.connected) {
      replaceSelections(interruptSelections);
    }
  }, [connection.connected, replaceSelections]);

  useLayoutEffect(() => {
    const previous = previousConfigRef.current;
    previousConfigRef.current = normalizedConfig.ref;
    if (previous !== normalizedConfig.ref) {
      replaceSelections(interruptForNewConfig);
    }
  }, [normalizedConfig.ref, replaceSelections]);

  useLayoutEffect(() => {
    replaceSelections((current) =>
      reconcileSelections(
        current,
        normalizedConfig.entries,
        normalizedConfig.ref,
      ),
    );
  }, [normalizedConfig.entries, normalizedConfig.ref, replaceSelections]);

  const assertMounted = useCallback((): void => {
    if (!mounted.current) {
      throw new Error("useLiveUpload is not mounted in a browser document");
    }
  }, []);

  const dispatchFiles = useCallback(
    (files: readonly File[], form: HTMLFormElement): void => {
      bridge.uploadTo(
        normalizedOptions.target ?? form,
        normalizedConfig.name,
        files,
      );
    },
    [bridge, normalizedConfig.name, normalizedOptions.target],
  );

  const addFiles = useCallback(
    (filesValue: UploadFiles | null | undefined): void => {
      assertMounted();
      if (!connection.connected) {
        throw new Error(
          "useLiveUpload cannot add files while LiveView is disconnected",
        );
      }
      const files = normalizeUploadFiles(filesValue);
      if (files.length === 0) return;
      const includesInterrupted = selectionsRef.current.some(
        (selection) =>
          selection.status === "interrupted" &&
          files.some((file) => sameFiles(selection.file, file)),
      );
      if (includesInterrupted) {
        throw new Error(
          "useLiveUpload interrupted files must be retried with retryInterrupted()",
        );
      }

      const { form } = resolveInput();
      rememberFiles(files, "selected", normalizedConfig.ref);
      dispatchFiles(files, form);
    },
    [
      assertMounted,
      connection.connected,
      dispatchFiles,
      normalizedConfig.ref,
      rememberFiles,
      resolveInput,
    ],
  );

  const retryInterrupted = useCallback((): void => {
    assertMounted();
    if (!connection.connected) {
      throw new Error(
        "useLiveUpload cannot retry files while LiveView is disconnected",
      );
    }
    const interrupted = selectionsRef.current.filter(
      ({ status }) => status === "interrupted",
    );
    if (interrupted.length === 0) return;
    if (
      interrupted.some(
        ({ uploadConfigRef }) => uploadConfigRef === normalizedConfig.ref,
      )
    ) {
      throw new Error(
        "useLiveUpload retry requires a refreshed upload config ref",
      );
    }

    const { form } = resolveInput();
    const retries = Object.freeze(
      interrupted.map((selection) =>
        Object.freeze({
          file: cloneFileForRetry(selection.file),
          selectionKey: selection.key,
        }),
      ),
    );
    const files = Object.freeze(retries.map(({ file }) => file));
    assertSelectionCapacity(
      normalizedConfig,
      selectionsRef.current.filter(({ status }) => status !== "interrupted"),
      files,
    );
    replaceSelections((current) =>
      Object.freeze(
        current.map((selection) => {
          const retry = retries.find(
            ({ selectionKey }) => selectionKey === selection.key,
          );
          return retry === undefined
            ? selection
            : Object.freeze({
                ...selection,
                entryRef: null,
                file: retry.file,
                status: "selected" as const,
                uploadConfigRef: normalizedConfig.ref,
              });
        }),
      ),
    );
    dispatchFiles(files, form);
  }, [
    assertMounted,
    connection.connected,
    dispatchFiles,
    normalizedConfig,
    replaceSelections,
    resolveInput,
  ]);

  const pushCancel = useCallback(
    (entryRef: string, payload: EventPayload = {}): Promise<unknown> => {
      assertMounted();
      const eventName = normalizedOptions.cancelEvent;
      if (eventName === undefined) {
        return Promise.reject(
          new Error("useLiveUpload cancel is unavailable without cancelEvent"),
        );
      }
      if (
        entryRef.length === 0 ||
        !normalizedConfig.entries.some(({ ref }) => ref === entryRef)
      ) {
        return Promise.reject(
          new TypeError(
            `useLiveUpload cannot cancel unknown entry ref "${entryRef}"`,
          ),
        );
      }
      const eventPayload = Object.freeze({
        ...payload,
        name: normalizedConfig.name,
        ref: entryRef,
      });

      return normalizedOptions.target === undefined
        ? bridge.pushEvent(eventName, eventPayload)
        : bridge.pushEventTo(normalizedOptions.target, eventName, eventPayload);
    },
    [
      bridge,
      normalizedConfig.entries,
      normalizedConfig.name,
      normalizedOptions,
      assertMounted,
    ],
  );

  const cancelAll = useCallback(
    (payload: EventPayload = {}): Promise<readonly unknown[]> => {
      assertMounted();
      const cancellableRefs = normalizedConfig.entries
        .filter(({ cancelled, done }) => !cancelled && !done)
        .map(({ ref }) => ref);
      return Promise.all(
        cancellableRefs.map((ref) => pushCancel(ref, payload)),
      ).then((replies) => Object.freeze(replies));
    },
    [assertMounted, normalizedConfig.entries, pushCancel],
  );

  const openFileDialog = useCallback((): void => {
    assertMounted();
    resolveInput().input.click();
  }, [assertMounted, resolveInput]);

  const submit = useCallback((): void => {
    assertMounted();
    if (!connection.connected) {
      throw new Error(
        "useLiveUpload cannot submit while LiveView is disconnected",
      );
    }
    const { form } = resolveInput();
    if (
      form.getAttribute("phx-submit") === null &&
      form.getAttribute("data-phx-submit") === null
    ) {
      throw new Error(
        "useLiveUpload submit requires a form phx-submit binding",
      );
    }
    form.requestSubmit();
  }, [assertMounted, connection.connected, resolveInput]);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      const files = normalizeUploadFiles(event.dataTransfer?.files);
      rememberFiles(
        files,
        connectedRef.current ? "selected" : "interrupted",
        normalizedConfig.ref,
      );
    },
    [normalizedConfig.ref, rememberFiles],
  );

  const dropTargetProps = useMemo(
    () =>
      Object.freeze({
        "phx-drop-target": normalizedConfig.ref,
        onDrop,
      }),
    [normalizedConfig.ref, onDrop],
  );
  const errors = useMemo(
    () => Object.freeze(normalizedConfig.errors.map(({ error }) => error)),
    [normalizedConfig.errors],
  );
  const formErrors = useMemo(
    () =>
      Object.freeze(
        normalizedConfig.errors
          .filter(({ ref }) => ref === normalizedConfig.ref)
          .map(({ error }) => error),
      ),
    [normalizedConfig.errors, normalizedConfig.ref],
  );
  const isUploading = normalizedConfig.entries.some(
    ({ cancelled, done, preflighted, progress }) =>
      !cancelled && !done && (preflighted || progress > 0),
  );

  return useMemo(
    () =>
      Object.freeze({
        accept: normalizedConfig.accept,
        acceptAttribute:
          normalizedConfig.accept === "any"
            ? undefined
            : normalizedConfig.accept.join(","),
        addFiles,
        autoUpload: normalizedConfig.auto_upload,
        cancel: pushCancel,
        cancelAll,
        connected: connection.connected,
        dropTargetProps,
        entries: normalizedConfig.entries,
        errors,
        formErrors,
        inputId: normalizedConfig.ref,
        isUploading,
        maxEntries: normalizedConfig.max_entries,
        maxEntriesMode: normalizedConfig.max_entries_mode,
        maxFileSize: normalizedConfig.max_file_size,
        multiple: normalizedConfig.max_entries > 1,
        name: normalizedConfig.name,
        openFileDialog,
        reconnecting: connection.reconnecting,
        retryInterrupted,
        selections,
        submit,
      }),
    [
      addFiles,
      cancelAll,
      connection.connected,
      connection.reconnecting,
      dropTargetProps,
      errors,
      formErrors,
      isUploading,
      normalizedConfig,
      openFileDialog,
      pushCancel,
      retryInterrupted,
      selections,
      submit,
    ],
  );
}
