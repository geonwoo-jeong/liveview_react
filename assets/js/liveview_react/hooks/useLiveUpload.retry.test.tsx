import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveViewReactProvider } from "../context";
import {
  createConnectionStore,
  type ConnectionStore,
} from "../runtime/connection";
import { LiveViewConnectionProvider } from "../runtime/connection-context";
import type { LiveUploadConfig, LiveViewReactContextValue } from "../types";
import type { UseLiveUploadResult } from "./useLiveUpload";
import {
  createBridge,
  entryFor,
  installLiveInput,
  uploadConfig,
  UploadProbe,
} from "./useLiveUpload.test-support";

describe("useLiveUpload reconnect and retry", () => {
  let bridge: LiveViewReactContextValue;
  let config: LiveUploadConfig;
  let connectionStore: ConnectionStore;
  let form: HTMLFormElement;
  let input: HTMLInputElement;
  let root: Root;
  let target: HTMLDivElement;
  let captured: { current?: UseLiveUploadResult };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    config = uploadConfig();
    ({ form, input } = installLiveInput(config));
    target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    connectionStore = createConnectionStore();
    bridge = createBridge(target);
    captured = {};
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderHook(nextConfig: LiveUploadConfig = config) {
    await act(async () => {
      root.render(
        <LiveViewReactProvider value={bridge}>
          <LiveViewConnectionProvider store={connectionStore}>
            <UploadProbe
              capture={captured}
              config={nextConfig}
              options={{
                changeEvent: "validate",
                formId: "upload-form",
                submitEvent: "save",
              }}
            />
          </LiveViewConnectionProvider>
        </LiveViewReactProvider>,
      );
    });
  }

  function api(): UseLiveUploadResult {
    if (captured.current === undefined) {
      throw new Error("Expected useLiveUpload result");
    }
    return captured.current;
  }

  it("retries a Phoenix-tagged file as a fresh clone and reconciles it", async () => {
    const uploadTo = vi.fn();
    bridge = createBridge(target, { uploadTo });
    await renderHook();
    const file = new File(["resume-bytes"], "resume.png", {
      lastModified: 1_700_000_000_123,
      type: "image/png",
    });
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      enumerable: true,
      value: "photos/resume.png",
      writable: false,
    });
    await act(async () => api().addFiles([file]));
    Object.defineProperty(file, "_phxRef", {
      configurable: true,
      value: "stale-phoenix-ref",
    });
    uploadTo.mockClear();

    await act(async () => connectionStore.setDisconnected());
    expect(api().connected).toBe(false);
    expect(api().reconnecting).toBe(true);
    expect(api().selections[0]?.status).toBe("interrupted");
    expect(() => api().addFiles([new File(["x"], "x.png")])).toThrow(
      "while LiveView is disconnected",
    );

    await act(async () => connectionStore.setConnected());
    expect(uploadTo).not.toHaveBeenCalled();
    expect(() => api().retryInterrupted()).toThrow(
      "requires a refreshed upload config ref",
    );

    const refreshed = uploadConfig({ errors: [], ref: "upload-ref-2" });
    input.id = "upload-ref-2";
    input.setAttribute("data-phx-upload-ref", "upload-ref-2");
    await renderHook(refreshed);
    expect(uploadTo).not.toHaveBeenCalled();

    await act(async () => api().retryInterrupted());
    expect(uploadTo).toHaveBeenCalledOnce();
    const retriedFiles = uploadTo.mock.calls[0]?.[2] as
      | readonly File[]
      | undefined;
    const retriedFile = retriedFiles?.[0];
    if (retriedFile === undefined) {
      throw new Error("Expected a retried File fixture");
    }
    expect(uploadTo).toHaveBeenCalledWith(form, "avatar", [retriedFile]);
    expect(retriedFile).not.toBe(file);
    expect(Object.hasOwn(retriedFile, "_phxRef")).toBe(false);
    expect(retriedFile).toMatchObject({
      lastModified: file.lastModified,
      name: file.name,
      type: file.type,
      webkitRelativePath: file.webkitRelativePath,
    });
    expect(new Uint8Array(await retriedFile.arrayBuffer())).toEqual(
      new Uint8Array(await file.arrayBuffer()),
    );
    expect(
      Object.getOwnPropertyDescriptor(retriedFile, "webkitRelativePath"),
    ).toMatchObject({ value: "photos/resume.png", writable: false });
    expect(api().selections[0]).toMatchObject({
      entryRef: null,
      file: retriedFile,
      status: "selected",
      uploadConfigRef: "upload-ref-2",
    });

    const tracked = uploadConfig({
      entries: [entryFor(retriedFile, "retried-entry")],
      errors: [],
      ref: "upload-ref-2",
    });
    await renderHook(tracked);
    expect(api().selections[0]?.entryRef).toBe("retried-entry");

    const completed = uploadConfig({
      entries: [
        entryFor(retriedFile, "retried-entry", {
          done: true,
          progress: 100,
        }),
      ],
      errors: [],
      ref: "upload-ref-2",
    });
    await renderHook(completed);
    expect(api().selections).toEqual([]);
  });

  it("prunes retained files after linked entries terminate or disappear", async () => {
    const initial = uploadConfig({
      auto_upload: false,
      entries: [],
      errors: [],
    });
    input.removeAttribute("data-phx-auto-upload");
    await renderHook(initial);
    const first = new File(["first"], "first.png", {
      lastModified: 101,
      type: "image/png",
    });
    const second = new File(["second"], "second.png", {
      lastModified: 102,
      type: "image/png",
    });
    const third = new File(["third"], "third.png", {
      lastModified: 103,
      type: "image/png",
    });

    await act(async () => api().addFiles([first, second, third]));
    expect(api().selections.every(({ entryRef }) => entryRef === null)).toBe(
      true,
    );

    const tracked = uploadConfig({
      auto_upload: false,
      entries: [
        entryFor(first, "server-first"),
        entryFor(second, "server-second"),
        entryFor(third, "server-third"),
      ],
      errors: [],
    });
    await renderHook(tracked);
    expect(api().selections.map(({ entryRef }) => entryRef)).toEqual([
      "server-first",
      "server-second",
      "server-third",
    ]);

    const terminal = uploadConfig({
      auto_upload: false,
      entries: [
        entryFor(first, "server-first", { done: true, progress: 100 }),
        entryFor(second, "server-second", { cancelled: true }),
      ],
      errors: [],
    });
    await renderHook(terminal);
    expect(api().selections).toEqual([]);
  });

  it("rejects retry when a refreshed config has fewer available entries", async () => {
    const initial = uploadConfig({
      auto_upload: false,
      entries: [],
      errors: [],
      max_entries: 3,
    });
    input.removeAttribute("data-phx-auto-upload");
    await renderHook(initial);
    const files = [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
    ];
    await act(async () => api().addFiles(files));
    await act(async () => connectionStore.setDisconnected());
    await act(async () => connectionStore.setConnected());

    const narrowed = uploadConfig({
      auto_upload: false,
      entries: [],
      errors: [],
      max_entries: 1,
      ref: "narrowed-ref",
    });
    input.id = "narrowed-ref";
    input.setAttribute("data-phx-upload-ref", "narrowed-ref");
    input.multiple = false;
    await renderHook(narrowed);

    expect(() => api().retryInterrupted()).toThrow("exceeds max_entries (1)");
    expect(api().selections).toHaveLength(2);
    expect(
      api().selections.every(({ status }) => status === "interrupted"),
    ).toBe(true);
  });
});
