import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveViewReactProvider } from "../context";
import {
  createConnectionStore,
  type ConnectionStore,
} from "../runtime/connection";
import { LiveViewConnectionProvider } from "../runtime/connection-context";
import type { LiveUploadConfig, LiveViewReactContextValue } from "../types";
import { normalizeLiveUploadConfig, resolveLiveUploadInput } from "../uploads";
import {
  useLiveUpload,
  type UseLiveUploadOptions,
  type UseLiveUploadResult,
} from "./useLiveUpload";
import {
  createBridge,
  installLiveInput,
  setInputFiles,
  uploadConfig,
  UploadProbe,
} from "./useLiveUpload.test-support";

describe("upload config and live input boundary", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("normalizes the complete public wire shape into immutable values", () => {
    const config = uploadConfig({
      errors: [
        {
          error: { details: ["too_large"] },
          ref: "entry-1",
        },
      ],
      max_entries_mode: "total",
    });
    const normalized = normalizeLiveUploadConfig(config);

    expect(normalized.max_entries_mode).toBe("total");
    expect(normalized.entries[0]).toMatchObject({
      cancelled: false,
      client_last_modified: 1_700_000_000_000,
      client_relative_path: "",
      progress: 45,
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.entries)).toBe(true);
    expect(Object.isFrozen(normalized.entries[0])).toBe(true);
    expect(Object.isFrozen(normalized.errors[0]?.error)).toBe(true);
  });

  it("rejects invalid fields, references, and unsafe nested error values", () => {
    expect(() =>
      normalizeLiveUploadConfig(
        uploadConfig({ internal_pid: "must-not-leak" }),
      ),
    ).toThrow("unexpected internal_pid");
    expect(() =>
      normalizeLiveUploadConfig(
        uploadConfig({
          entries: [uploadConfig().entries[0], uploadConfig().entries[0]],
        }),
      ),
    ).toThrow("unique refs");
    expect(() =>
      normalizeLiveUploadConfig(
        uploadConfig({
          errors: [{ error: "invalid", ref: "another-upload" }],
        }),
      ),
    ).toThrow("does not identify this upload");

    const unsafeError = JSON.parse(
      '{"error":{"constructor":{"prototype":{"polluted":true}}},"ref":"upload-ref"}',
    ) as unknown;
    expect(() =>
      normalizeLiveUploadConfig(uploadConfig({ errors: [unsafeError] })),
    ).toThrow('forbidden object key "constructor"');

    const cyclicError: { self?: unknown } = {};
    cyclicError.self = cyclicError;
    expect(() =>
      normalizeLiveUploadConfig(
        uploadConfig({ errors: [{ error: cyclicError, ref: "upload-ref" }] }),
      ),
    ).toThrow(/cyclic/i);

    let deeplyNestedError: unknown = "too deep";
    for (let depth = 0; depth < 65; depth += 1) {
      deeplyNestedError = { nested: deeplyNestedError };
    }
    expect(() =>
      normalizeLiveUploadConfig(
        uploadConfig({
          errors: [{ error: deeplyNestedError, ref: "upload-ref" }],
        }),
      ),
    ).toThrow(/maximum encoded nesting depth/i);
  });

  it("validates the actual live_file_input, form contract, and duplicate names", () => {
    const config = uploadConfig();
    const normalized = normalizeLiveUploadConfig(config);
    const { form, input } = installLiveInput(config);

    expect(
      resolveLiveUploadInput(normalized, {
        bridgeElement: null,
        changeEvent: "validate",
        formId: "upload-form",
        submitEvent: "save",
      }),
    ).toEqual({ form, input });

    input.accept = ".jpg";
    expect(() =>
      resolveLiveUploadInput(normalized, { bridgeElement: null }),
    ).toThrow("accept attribute inconsistent");
    input.accept = ".png,image/jpeg";

    form.removeAttribute("phx-change");
    expect(() =>
      resolveLiveUploadInput(normalized, { bridgeElement: null }),
    ).toThrow("requires a form phx-change binding");
    form.setAttribute("phx-change", "validate");

    const duplicate = input.cloneNode() as HTMLInputElement;
    duplicate.id = "other-ref";
    duplicate.setAttribute("data-phx-upload-ref", "other-ref");
    form.append(duplicate);
    expect(() =>
      resolveLiveUploadInput(normalized, { bridgeElement: null }),
    ).toThrow('duplicate live file inputs named "avatar"');
  });

  it("keeps selector and numeric component targets narrow", () => {
    const config = uploadConfig();
    const normalized = normalizeLiveUploadConfig(config);
    const { form, input } = installLiveInput(config);
    const component = document.createElement("section");
    component.setAttribute("data-phx-component", "7");
    form.insertBefore(component, input);
    component.append(input);

    expect(
      resolveLiveUploadInput(normalized, {
        bridgeElement: null,
        target: 7,
      }).input,
    ).toBe(input);
    expect(() =>
      resolveLiveUploadInput(normalized, {
        bridgeElement: null,
        target: 8,
      }),
    ).toThrow("outside component target 8");
    expect(() =>
      resolveLiveUploadInput(normalized, {
        bridgeElement: null,
        target: "#missing-component",
      }),
    ).toThrow("#missing-component");
  });

  it("uses an HTMLElement's own realm and rejects cross-document targets", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);

    try {
      const foreignDocument = iframe.contentDocument;
      if (foreignDocument === null || foreignDocument.defaultView === null) {
        throw new Error("Expected an iframe document fixture");
      }

      const config = uploadConfig();
      const normalized = normalizeLiveUploadConfig(config);
      const form = foreignDocument.createElement("form");
      form.id = "foreign-upload-form";
      form.setAttribute("phx-change", "validate");
      form.setAttribute("phx-submit", "save");
      const input = foreignDocument.createElement("input");
      input.id = normalized.ref;
      input.type = "file";
      input.name = normalized.name;
      input.setAttribute("data-phx-hook", "Phoenix.LiveFileUpload");
      input.setAttribute("data-phx-upload-ref", normalized.ref);
      input.setAttribute("data-phx-auto-upload", "");
      input.accept =
        normalized.accept === "any" ? "" : normalized.accept.join(",");
      input.multiple = normalized.max_entries > 1;
      form.append(input);
      foreignDocument.body.append(form);
      const bridgeElement = foreignDocument.createElement("div");
      foreignDocument.body.append(bridgeElement);

      expect(
        resolveLiveUploadInput(normalized, {
          bridgeElement,
          target: form,
        }),
      ).toEqual({ form, input });

      expect(() =>
        resolveLiveUploadInput(normalized, {
          bridgeElement,
          target: document.createElement("form"),
        }),
      ).toThrow("target belongs to another document");
    } finally {
      iframe.remove();
    }
  });
});

describe("useLiveUpload", () => {
  let bridge: LiveViewReactContextValue;
  let config: LiveUploadConfig;
  let connectionStore: ConnectionStore;
  let form: HTMLFormElement;
  let input: HTMLInputElement;
  let root: Root;
  let rootMounted: boolean;
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
    rootMounted = true;
    connectionStore = createConnectionStore();
    bridge = createBridge(target);
    captured = {};
  });

  afterEach(async () => {
    if (rootMounted) await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderHook(
    nextConfig: LiveUploadConfig = config,
    options: UseLiveUploadOptions = {
      changeEvent: "validate",
      formId: "upload-form",
      submitEvent: "save",
    },
    strict = false,
  ): Promise<void> {
    await act(async () => {
      root.render(
        strict ? (
          <StrictMode>
            <LiveViewReactProvider value={bridge}>
              <LiveViewConnectionProvider store={connectionStore}>
                <UploadProbe
                  capture={captured}
                  config={nextConfig}
                  options={options}
                />
              </LiveViewConnectionProvider>
            </LiveViewReactProvider>
          </StrictMode>
        ) : (
          <LiveViewReactProvider value={bridge}>
            <LiveViewConnectionProvider store={connectionStore}>
              <UploadProbe
                capture={captured}
                config={nextConfig}
                options={options}
              />
            </LiveViewConnectionProvider>
          </LiveViewReactProvider>
        ),
      );
    });
  }

  function api(): UseLiveUploadResult {
    if (captured.current === undefined) {
      throw new Error("Expected useLiveUpload result");
    }
    return captured.current;
  }

  it("is SSR-safe and defers DOM validation until layout commit", () => {
    document.body.replaceChildren();
    const serverStore = createConnectionStore();
    const serverBridge = createBridge(document.createElement("div"));

    function Probe() {
      useLiveUpload(config);
      return null;
    }

    expect(() =>
      renderToStaticMarkup(
        <LiveViewReactProvider value={serverBridge}>
          <LiveViewConnectionProvider store={serverStore}>
            <Probe />
          </LiveViewConnectionProvider>
        </LiveViewReactProvider>,
      ),
    ).not.toThrow();
  });

  it("rejects structural target impostors during render", () => {
    const serverStore = createConnectionStore();
    const serverBridge = createBridge(document.createElement("div"));

    function Probe() {
      useLiveUpload(config, {
        target: { nodeType: 1 } as unknown as HTMLElement,
      });
      return null;
    }

    expect(() =>
      renderToStaticMarkup(
        <LiveViewReactProvider value={serverBridge}>
          <LiveViewConnectionProvider store={serverStore}>
            <Probe />
          </LiveViewConnectionProvider>
        </LiveViewReactProvider>,
      ),
    ).toThrow("target must be a selector, component id, or HTMLElement");
  });

  it("targets the associated form when addFiles is outside the React root", async () => {
    const upload = vi.fn();
    const uploadTo = vi.fn();
    bridge = createBridge(target, { upload, uploadTo });
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    await renderHook();

    expect(api()).toMatchObject({
      acceptAttribute: ".png,image/jpeg",
      autoUpload: true,
      connected: true,
      inputId: "upload-ref",
      isUploading: true,
      maxEntries: 3,
      maxEntriesMode: "selected",
      maxFileSize: 8_000_000,
      multiple: true,
      name: "avatar",
    });
    expect(api().entries[0]?.progress).toBe(45);
    expect(api().errors).toEqual(["too_many_files", "too_large"]);
    expect(api().formErrors).toEqual(["too_many_files"]);
    expect(Object.isFrozen(api())).toBe(true);

    api().openFileDialog();
    expect(click).toHaveBeenCalledOnce();

    const first = new File(["first"], "first.png", { type: "image/png" });
    await act(async () => api().addFiles([first]));
    expect(target.contains(form)).toBe(false);
    expect(uploadTo).toHaveBeenCalledWith(form, "avatar", [first]);
    expect(upload).not.toHaveBeenCalled();
    expect(api().selections).toHaveLength(1);
    expect(api().selections[0]).toMatchObject({
      file: first,
      status: "selected",
      uploadConfigRef: "upload-ref",
    });
    expect(Object.isFrozen(api().selections)).toBe(true);
    expect(Object.isFrozen(api().selections[0])).toBe(true);
    expect(Object.isFrozen(first)).toBe(false);
  });

  it("captures native picker and drop files without duplicating official drop uploads", async () => {
    const uploadTo = vi.fn();
    bridge = createBridge(target, { uploadTo });
    await renderHook();
    const picked = new File(["picked"], "picked.png", { type: "image/png" });
    setInputFiles(input, [picked]);

    await act(async () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(api().selections.map(({ file }) => file)).toEqual([picked]);

    const dropped = new File(["dropped"], "dropped.png", {
      type: "image/png",
    });
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    await act(async () => {
      api().dropTargetProps.onDrop({
        dataTransfer: { files: setInputFiles(input, [dropped]) },
        preventDefault,
        stopPropagation,
      } as unknown as Parameters<
        UseLiveUploadResult["dropTargetProps"]["onDrop"]
      >[0]);
    });

    expect(api().dropTargetProps["phx-drop-target"]).toBe("upload-ref");
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(uploadTo).not.toHaveBeenCalled();
    expect(api().selections.map(({ file }) => file)).toEqual([picked, dropped]);
  });

  it("rejects picker, addFiles, and drop batches that exceed max_entries", async () => {
    const limited = uploadConfig({
      auto_upload: false,
      entries: [],
      errors: [],
      max_entries: 1,
    });
    input.multiple = false;
    input.removeAttribute("data-phx-auto-upload");
    const uploadTo = vi.fn();
    bridge = createBridge(target, { uploadTo });
    await renderHook(limited);
    const files = [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
    ];

    expect(() => api().addFiles(files)).toThrow("exceeds max_entries (1)");
    expect(() =>
      api().dropTargetProps.onDrop({
        dataTransfer: { files: setInputFiles(input, files) },
      } as unknown as Parameters<
        UseLiveUploadResult["dropTargetProps"]["onDrop"]
      >[0]),
    ).toThrow("exceeds max_entries (1)");
    expect(uploadTo).not.toHaveBeenCalled();
    expect(api().selections).toEqual([]);

    const reportedErrors: ErrorEvent[] = [];
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      reportedErrors.push(event);
    };
    window.addEventListener("error", onError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await act(async () => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    } finally {
      consoleError.mockRestore();
      window.removeEventListener("error", onError);
    }
    expect(reportedErrors[0]?.error).toMatchObject({
      message: "useLiveUpload selection exceeds max_entries (1)",
    });
    expect(api().selections).toEqual([]);
  });

  it("replaces a sole selection while dispatching each max_entries one upload", async () => {
    const limited = uploadConfig({
      auto_upload: false,
      entries: [],
      errors: [],
      max_entries: 1,
    });
    input.multiple = false;
    input.removeAttribute("data-phx-auto-upload");
    const upload = vi.fn();
    const uploadTo = vi.fn();
    bridge = createBridge(target, { upload, uploadTo });
    await renderHook(limited);
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", {
      type: "image/png",
    });

    await act(async () => api().addFiles([first]));
    const firstKey = api().selections[0]?.key;
    await act(async () => api().addFiles([second]));

    expect(uploadTo.mock.calls).toEqual([
      [form, "avatar", [first]],
      [form, "avatar", [second]],
    ]);
    expect(upload).not.toHaveBeenCalled();
    expect(api().selections).toHaveLength(1);
    expect(api().selections[0]?.file).toBe(second);
    expect(api().selections[0]?.key).not.toBe(firstKey);
  });

  it("counts only active entries plus pending files for total-mode capacity", async () => {
    const baseEntries = uploadConfig().entries;
    const active = baseEntries[0];
    const done = baseEntries[1];
    if (active === undefined || done === undefined) {
      throw new Error("Expected upload entry fixtures");
    }
    const cancelled = {
      ...done,
      cancelled: true,
      done: false,
      progress: 20,
      ref: "entry-cancelled",
    };
    const totalMode = uploadConfig({
      entries: [active, done, cancelled],
      errors: [
        { error: "too_large", ref: "entry-1" },
        { error: "cancelled", ref: "entry-cancelled" },
      ],
      max_entries: 2,
      max_entries_mode: "total",
    });
    const uploadTo = vi.fn();
    bridge = createBridge(target, { uploadTo });
    await renderHook(totalMode);
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", {
      type: "image/png",
    });

    await act(async () => api().addFiles([first]));
    expect(uploadTo).toHaveBeenCalledOnce();
    expect(() => api().addFiles([second])).toThrow("exceeds max_entries (2)");
    expect(uploadTo).toHaveBeenCalledOnce();
  });

  it("uses targeted public events for cancellation and actual form submission", async () => {
    const pushEventTo = vi.fn(() =>
      Promise.resolve([
        { status: "fulfilled", value: { ref: 1, reply: "cancelled" } },
      ]),
    );
    const uploadTo = vi.fn();
    bridge = createBridge(target, {
      pushEventTo: pushEventTo as LiveViewReactContextValue["pushEventTo"],
      uploadTo,
    });
    const requestSubmit = vi
      .spyOn(form, "requestSubmit")
      .mockImplementation(() => undefined);
    const manual = uploadConfig({ auto_upload: false });
    input.removeAttribute("data-phx-auto-upload");
    await renderHook(manual, {
      cancelEvent: "cancel_upload",
      changeEvent: "validate",
      formId: "upload-form",
      submitEvent: "save",
      target: "#upload-form",
    });

    const targetedFile = new File(["targeted"], "targeted.png", {
      type: "image/png",
    });
    await act(async () => api().addFiles([targetedFile]));
    expect(uploadTo).toHaveBeenCalledWith("#upload-form", "avatar", [
      targetedFile,
    ]);

    await expect(
      api().cancel("entry-1", {
        name: "attacker-name",
        reason: "user",
        ref: "attacker-ref",
      }),
    ).resolves.toEqual([
      { status: "fulfilled", value: { ref: 1, reply: "cancelled" } },
    ]);
    expect(pushEventTo).toHaveBeenCalledWith("#upload-form", "cancel_upload", {
      name: "avatar",
      reason: "user",
      ref: "entry-1",
    });

    await expect(api().cancelAll({ scope: "all" })).resolves.toHaveLength(1);
    expect(pushEventTo).toHaveBeenLastCalledWith(
      "#upload-form",
      "cancel_upload",
      { name: "avatar", ref: "entry-1", scope: "all" },
    );
    api().submit();
    expect(requestSubmit).toHaveBeenCalledOnce();
    form.removeAttribute("phx-submit");
    expect(() => api().submit()).toThrow("expected form phx-submit");
  });

  it("keeps one native listener in StrictMode and removes it on unmount", async () => {
    const addEventListener = vi.spyOn(input, "addEventListener");
    const removeEventListener = vi.spyOn(input, "removeEventListener");
    await renderHook(config, undefined, true);

    expect(
      addEventListener.mock.calls.filter(([name]) => name === "input"),
    ).toHaveLength(2);
    expect(
      removeEventListener.mock.calls.filter(([name]) => name === "input"),
    ).toHaveLength(1);

    const file = new File(["one"], "one.png", { type: "image/png" });
    setInputFiles(input, [file]);
    await act(async () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(api().selections).toHaveLength(1);

    await act(async () => root.unmount());
    rootMounted = false;
    expect(
      removeEventListener.mock.calls.filter(([name]) => name === "input"),
    ).toHaveLength(2);
    const lastResult = api();
    const afterUnmount = new File(["two"], "two.png", { type: "image/png" });
    setInputFiles(input, [afterUnmount]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(captured.current).toBe(lastResult);
    expect(captured.current?.selections).toHaveLength(1);
    expect(() => lastResult.cancel("entry-1")).toThrow(
      "useLiveUpload is not mounted in a browser document",
    );
    expect(() => lastResult.cancelAll()).toThrow(
      "useLiveUpload is not mounted in a browser document",
    );
  });
});
