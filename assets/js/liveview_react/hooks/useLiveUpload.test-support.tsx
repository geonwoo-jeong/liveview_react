import { vi } from "vitest";

import type {
  LiveUploadConfig,
  LiveViewReactContextValue,
  PushEvent,
} from "../types";
import { normalizeLiveUploadConfig } from "../uploads";
import {
  useLiveUpload,
  type UseLiveUploadOptions,
  type UseLiveUploadResult,
} from "./useLiveUpload";

export function uploadConfig(
  overrides: Readonly<Record<string, unknown>> = {},
): LiveUploadConfig {
  return {
    accept: [".png", "image/jpeg"],
    auto_upload: true,
    entries: [
      {
        cancelled: false,
        client_last_modified: 1_700_000_000_000,
        client_name: "avatar.png",
        client_relative_path: "",
        client_size: 12,
        client_type: "image/png",
        done: false,
        errors: ["too_large"],
        preflighted: true,
        progress: 45,
        ref: "entry-1",
        valid: false,
      },
      {
        cancelled: false,
        client_last_modified: 1_700_000_000_001,
        client_name: "finished.png",
        client_relative_path: "photos/finished.png",
        client_size: 6,
        client_type: "image/png",
        done: true,
        errors: [],
        preflighted: true,
        progress: 100,
        ref: "entry-2",
        valid: true,
      },
    ],
    errors: [
      { error: "too_many_files", ref: "upload-ref" },
      { error: "too_large", ref: "entry-1" },
    ],
    max_entries: 3,
    max_entries_mode: "selected",
    max_file_size: 8_000_000,
    name: "avatar",
    ref: "upload-ref",
    ...overrides,
  } as unknown as LiveUploadConfig;
}

export function createBridge(
  element: HTMLElement,
  overrides: Partial<LiveViewReactContextValue> = {},
): LiveViewReactContextValue {
  return {
    el: element,
    handleEvent: vi.fn(),
    liveSocket: null,
    pushEvent: vi.fn(() => Promise.resolve(null)) as PushEvent,
    pushEventTo: vi.fn(() => Promise.resolve([])),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
    ...overrides,
  };
}

export interface UploadProbeProps {
  readonly capture: { current?: UseLiveUploadResult };
  readonly config: LiveUploadConfig;
  readonly options: UseLiveUploadOptions;
}

export function UploadProbe({ capture, config, options }: UploadProbeProps) {
  capture.current = useLiveUpload(config, options);
  return <output>{capture.current.selections.length}</output>;
}

export function installLiveInput(
  config: LiveUploadConfig,
  formId = "upload-form",
): Readonly<{ form: HTMLFormElement; input: HTMLInputElement }> {
  const normalized = normalizeLiveUploadConfig(config);
  const form = document.createElement("form");
  form.id = formId;
  form.setAttribute("phx-change", "validate");
  form.setAttribute("phx-submit", "save");
  const input = document.createElement("input");
  input.id = normalized.ref;
  input.type = "file";
  input.name = normalized.name;
  input.setAttribute("data-phx-hook", "Phoenix.LiveFileUpload");
  input.setAttribute("data-phx-upload-ref", normalized.ref);
  if (normalized.accept !== "any") {
    input.accept = normalized.accept.join(",");
  }
  if (normalized.auto_upload) {
    input.setAttribute("data-phx-auto-upload", "");
  }
  input.multiple = normalized.max_entries > 1;
  form.append(input);
  document.body.append(form);
  return Object.freeze({ form, input });
}

export function setInputFiles(
  input: HTMLInputElement,
  files: readonly File[],
): FileList {
  const fileList = {
    ...Object.fromEntries(files.map((file, index) => [index, file])),
    item: (index: number) => files[index] ?? null,
    length: files.length,
  } as unknown as FileList;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: fileList,
  });
  return fileList;
}

export function entryFor(
  file: File,
  ref: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    cancelled: false,
    client_last_modified: file.lastModified,
    client_name: file.name,
    client_relative_path:
      typeof file.webkitRelativePath === "string"
        ? file.webkitRelativePath
        : "",
    client_size: file.size,
    client_type: file.type,
    done: false,
    errors: [],
    preflighted: false,
    progress: 0,
    ref,
    valid: true,
    ...overrides,
  });
}
