import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveViewReactProvider } from "../context";
import {
  formatPhoenixFieldName,
  setLiveFormValue,
  type LiveFormServerSnapshot,
  validateLiveFormPath,
  validateLiveFormServerSnapshot,
} from "../forms";
import { createConnectionStore } from "../runtime/connection";
import { LiveViewConnectionProvider } from "../runtime/connection-context";
import type { PushEvent } from "../types";
import { LIVE_FORM_SUBMIT_EVENT } from "./live-form-runtime";
import type { UseLiveFormResult } from "./useLiveForm";
import {
  createBridge,
  createDeferred,
  createEventBridge,
  FormProbe,
  INITIAL_VALUES,
  LiveFormSubmitCancelledError,
  serverForm,
  setInputValue,
  type Deferred,
  type EventBridge,
  type SubmitReply,
  type Values,
} from "./useLiveForm.test-support";

describe("useLiveForm", () => {
  let connection: ReturnType<typeof createConnectionStore>;
  let root: Root;
  let rootMounted: boolean;
  let target: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    connection = createConnectionStore();
    target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    rootMounted = true;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (rootMounted) await act(async () => root.unmount());
    connection.destroy();
    target.remove();
  });

  function renderProbe(
    snapshot: ReturnType<typeof serverForm>,
    bridge: EventBridge | PushEvent,
    captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    },
    debounce = 150,
    onParentChange?: () => void,
    strictMode = false,
  ): void {
    const context =
      typeof bridge === "function" ? createBridge(bridge) : bridge.value;
    const probe = (
      <FormProbe
        captured={captured}
        debounce={debounce}
        snapshot={snapshot}
        {...(onParentChange === undefined ? {} : { onParentChange })}
      />
    );
    root.render(
      <LiveViewConnectionProvider store={connection}>
        <LiveViewReactProvider value={context}>
          {strictMode ? <StrictMode>{probe}</StrictMode> : probe}
        </LiveViewReactProvider>
      </LiveViewConnectionProvider>,
    );
  }

  it("updates local values immediately and emits one debounced Phoenix payload", async () => {
    vi.useFakeTimers();
    const request = createDeferred<null>();
    const pushEvent = vi.fn(() => request.promise) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    let parentReactChanges = 0;
    await act(async () => {
      renderProbe(serverForm(), pushEvent, captured, 150, () => {
        parentReactChanges += 1;
      });
    });
    const baselineSettings = captured.current?.values.settings;

    const input = target.querySelector<HTMLInputElement>(
      '[data-testid="email"]',
    );
    if (!input) throw new Error("Expected email field");
    let escapedInputEvents = 0;
    const observeGlobalInput = (): void => {
      escapedInputEvents += 1;
    };
    document.addEventListener("input", observeGlobalInput);
    await act(async () => setInputValue(input, "dev@example.com"));
    document.removeEventListener("input", observeGlobalInput);

    expect(captured.current?.values.email).toBe("dev@example.com");
    expect(escapedInputEvents).toBe(0);
    expect(parentReactChanges).toBe(1);
    expect(captured.current?.dirty).toBe(true);
    expect(captured.current?.validating).toBe(true);
    expect(captured.current?.revision).toBe(1);
    expect(
      target.querySelector<HTMLInputElement>(
        'input[name="_liveview_react_revision"]',
      )?.value,
    ).toBe("1");
    expect(pushEvent).not.toHaveBeenCalled();
    expect(target.querySelector("form")?.getAttribute("phx-change")).toBe(
      "validate",
    );

    await act(async () => vi.advanceTimersByTime(150));
    expect(pushEvent).toHaveBeenCalledWith("validate", {
      profile: { ...INITIAL_VALUES, email: "dev@example.com" },
      _liveview_react_revision: 1,
      _target: ["profile", "email"],
    });
    await act(async () => request.resolve(null));
    expect(captured.current?.validating).toBe(true);
    await act(async () => {
      renderProbe(
        serverForm({
          revision: 1,
          values: { ...INITIAL_VALUES, email: "dev@example.com" },
        }),
        pushEvent,
        captured,
      );
    });
    expect(captured.current?.validating).toBe(false);
    expect(captured.current?.values.settings).toBe(baselineSettings);
  });

  it("ignores stale server snapshots and keeps the latest reset baseline", async () => {
    vi.useFakeTimers();
    const requests: Deferred<unknown>[] = [];
    const pushEvent = vi.fn(() => {
      const request = createDeferred<unknown>();
      requests.push(request);
      return request.promise;
    }) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    await act(async () => renderProbe(serverForm(), pushEvent, captured, 0));
    const input = target.querySelector<HTMLInputElement>(
      '[data-testid="email"]',
    );
    if (!input) throw new Error("Expected email field");

    await act(async () => {
      setInputValue(input, "first@example.com");
      vi.runOnlyPendingTimers();
    });
    await act(async () => {
      setInputValue(input, "second@example.com");
      vi.runOnlyPendingTimers();
    });
    expect(requests).toHaveLength(2);

    await act(async () => requests[1]?.resolve({}));
    expect(captured.current?.validating).toBe(true);
    await act(async () => {
      renderProbe(
        serverForm({
          errors: { email: ["current error"] },
          revision: 2,
          valid: false,
          values: { ...INITIAL_VALUES, email: "second@example.com" },
        }),
        pushEvent,
        captured,
        0,
      );
    });
    expect(captured.current?.errors).toEqual({
      email: ["current error"],
    });
    expect(captured.current?.valid).toBe(false);
    expect(captured.current?.validating).toBe(false);

    await act(async () => {
      requests[0]?.resolve({});
      renderProbe(
        serverForm({
          errors: { email: ["stale error"] },
          revision: 1,
          valid: false,
          values: { ...INITIAL_VALUES, email: "first@example.com" },
        }),
        pushEvent,
        captured,
        0,
      );
    });
    expect(captured.current?.errors).toEqual({
      email: ["current error"],
    });
    expect(captured.current?.values.email).toBe("second@example.com");
    await act(async () => captured.current?.reset());
    expect(captured.current?.values.email).toBe("second@example.com");
  });

  it("normalizes checkbox, radio, multiple select, number, and date controls", async () => {
    vi.useFakeTimers();
    const pushEvent = vi.fn(() => Promise.resolve(null)) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    await act(async () => renderProbe(serverForm(), pushEvent, captured, 500));

    const active = target.querySelector<HTMLInputElement>(
      '[data-testid="active"]',
    );
    const radio = target.querySelector<HTMLInputElement>(
      '[data-testid="role-admin"]',
    );
    const count = target.querySelector<HTMLInputElement>(
      '[data-testid="count"]',
    );
    const birthday = target.querySelector<HTMLInputElement>(
      '[data-testid="birthday"]',
    );
    const tags = target.querySelector<HTMLSelectElement>(
      '[data-testid="tags"]',
    );
    const featureAlpha = target.querySelector<HTMLInputElement>(
      '[data-testid="feature-alpha"]',
    );
    const featureBeta = target.querySelector<HTMLInputElement>(
      '[data-testid="feature-beta"]',
    );
    if (
      !active ||
      !radio ||
      !count ||
      !birthday ||
      !tags ||
      !featureAlpha ||
      !featureBeta
    ) {
      throw new Error("Expected form controls");
    }

    await act(async () => {
      active.click();
      featureBeta.click();
      featureAlpha.click();
      radio.click();
      setInputValue(count, "12.5");
      setInputValue(birthday, "2026-08-30");
      tags.options[0]!.selected = true;
      tags.options[1]!.selected = true;
      tags.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(captured.current?.values).toMatchObject({
      active: true,
      birthday: "2026-08-30",
      count: 12.5,
      features: ["beta", "alpha"],
      role: "admin",
      tags: ["elixir", "react"],
    });
    const activeHidden = target.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="profile[active]"]',
    );
    expect(activeHidden?.value).toBe("false");
    expect(active.value).toBe("true");
    expect(activeHidden?.nextElementSibling).toBe(active);
    expect(tags.name).toBe("profile[tags][]");
    expect(featureAlpha.name).toBe("profile[features][]");
    expect(
      target.querySelector('input[type="hidden"][name="profile[features][]"]'),
    ).toBeNull();
    expect(
      target.querySelector('input[type="hidden"][name="profile[role]"]'),
    ).toBeNull();
  });

  it("supports nested array names, touched errors, copy-on-write, and reset", async () => {
    vi.useFakeTimers();
    const pushEvent = vi.fn(() => Promise.resolve(null)) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    await act(async () => {
      renderProbe(
        serverForm({
          errors: { addresses: [{ city: ["is invalid"] }] },
          required: { addresses: [{ city: true }] },
        }),
        pushEvent,
        captured,
      );
    });
    const baseline = captured.current?.values;
    const city = target.querySelector<HTMLInputElement>('[data-testid="city"]');
    if (!baseline || !city) throw new Error("Expected city field");

    expect(city.name).toBe("profile[addresses][0][city]");
    expect(captured.current?.field(["addresses", 0, "city"])).toMatchObject({
      displayErrors: [],
      errors: ["is invalid"],
      required: true,
    });
    await act(async () => {
      city.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      setInputValue(city, "Kyoto");
    });

    expect(captured.current?.touched).toBe(true);
    expect(captured.current?.isTouched(["addresses", 0, "city"])).toBe(true);
    expect(captured.current?.isDirty(["addresses", 0, "city"])).toBe(true);
    expect(
      captured.current?.field(["addresses", 0, "city"]).displayErrors,
    ).toEqual(["is invalid"]);
    expect(captured.current?.values.settings).toBe(baseline.settings);
    expect(captured.current?.values.addresses).not.toBe(baseline.addresses);

    await act(async () => captured.current?.reset());
    expect(captured.current?.values).toBe(baseline);
    expect(captured.current?.dirty).toBe(false);
    expect(captured.current?.touched).toBe(false);
  });

  it("keeps validation and native phx-submit independent until the submit event", async () => {
    vi.useFakeTimers();
    const validation = createDeferred<LiveFormServerSnapshot<Values>>();
    const pushEvent = vi.fn(() => validation.promise) as PushEvent;
    const eventBridge = createEventBridge(pushEvent);
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    const preventNativeNavigation = (event: Event): void =>
      event.preventDefault();
    document.addEventListener("submit", preventNativeNavigation);

    try {
      await act(async () =>
        renderProbe(serverForm(), eventBridge, captured, 0),
      );
      await act(async () => {
        captured.current?.setValue(["email"], "save@example.com");
        vi.runOnlyPendingTimers();
      });
      expect(captured.current?.validating).toBe(true);

      let submitPromise!: Promise<SubmitReply | undefined>;
      await act(async () => {
        submitPromise = captured.current!.submit();
      });
      expect(captured.current?.submitting).toBe(true);
      expect(target.querySelector("form")?.getAttribute("phx-submit")).toBe(
        "save",
      );
      expect(
        target.querySelector("form")?.getAttribute("phx-auto-recover"),
      ).toBe("ignore");
      expect(pushEvent).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderProbe(
          serverForm({
            revision: 1,
            values: { ...INITIAL_VALUES, email: "save@example.com" },
          }),
          eventBridge,
          captured,
          0,
        );
      });
      expect(captured.current?.submitting).toBe(true);

      await act(async () =>
        eventBridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "profile-form",
          name: "profile",
          reply: { saved: true },
          revision: 1,
        }),
      );
      await expect(submitPromise).resolves.toEqual({ saved: true });
      expect(captured.current?.submitting).toBe(false);
      expect(captured.current?.submitReply).toEqual({ saved: true });

      await act(async () =>
        validation.resolve(
          serverForm({
            revision: 1,
            values: { ...INITIAL_VALUES, email: "save@example.com" },
          }),
        ),
      );
      expect(captured.current?.validating).toBe(false);
    } finally {
      document.removeEventListener("submit", preventNativeNavigation);
    }
  });

  it("preserves an explicit null submit event reply separately from no reply", async () => {
    const pushEvent = vi.fn(() => Promise.resolve({})) as PushEvent;
    const eventBridge = createEventBridge(pushEvent);
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    const preventNativeNavigation = (event: Event): void =>
      event.preventDefault();
    document.addEventListener("submit", preventNativeNavigation);

    try {
      await act(async () =>
        renderProbe(
          serverForm({
            values: { ...INITIAL_VALUES, email: "ready@example.com" },
          }),
          eventBridge,
          captured,
        ),
      );
      expect(captured.current?.submitReply).toBeUndefined();

      let submitPromise!: Promise<SubmitReply | undefined>;
      await act(async () => {
        submitPromise = captured.current!.submit();
      });
      await act(async () =>
        eventBridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "profile-form",
          name: "profile",
          reply: null,
          revision: 0,
        }),
      );

      await expect(submitPromise).resolves.toBeNull();
      expect(captured.current?.submitReply).toBeNull();
      expect(captured.current?.submitting).toBe(false);
    } finally {
      document.removeEventListener("submit", preventNativeNavigation);
    }
  });

  it("preserves dirty state across reconnect and revalidates exactly once", async () => {
    vi.useFakeTimers();
    const pushEvent = vi.fn(() => Promise.resolve(null)) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    await act(async () => renderProbe(serverForm(), pushEvent, captured, 100));
    await act(async () => {
      captured.current?.setValue(["email"], "offline@example.com");
      captured.current?.touch(["email"]);
      connection.setDisconnected();
    });
    await act(async () => {
      renderProbe(
        serverForm({
          errors: { email: ["server error"] },
          values: { ...INITIAL_VALUES, email: "server@example.com" },
        }),
        pushEvent,
        captured,
        100,
      );
    });

    expect(captured.current?.values.email).toBe("offline@example.com");
    expect(captured.current?.isTouched(["email"])).toBe(true);
    expect(captured.current?.errors).toEqual({ email: ["server error"] });
    expect(pushEvent).not.toHaveBeenCalled();

    await act(async () => connection.setConnected());
    await act(async () => vi.runOnlyPendingTimers());
    expect(pushEvent).toHaveBeenCalledTimes(1);
    expect(pushEvent).toHaveBeenCalledWith(
      "validate",
      expect.objectContaining({
        _liveview_react_revision: 1,
        profile: expect.objectContaining({ email: "offline@example.com" }),
      }),
    );

    await act(async () => captured.current?.reset());
    expect(captured.current?.values.email).toBe("server@example.com");
    expect(captured.current?.dirty).toBe(false);
    expect(captured.current?.touched).toBe(false);
    await act(async () => {
      renderProbe(
        serverForm({
          revision: 2,
          values: { ...INITIAL_VALUES, email: "authoritative@example.com" },
        }),
        pushEvent,
        captured,
        100,
      );
    });
    expect(captured.current?.values.email).toBe("authoritative@example.com");
  });

  it("rejects an in-flight submit on disconnect and never replays it", async () => {
    const pushEvent = vi.fn(() => Promise.resolve(null)) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    let nativeSubmits = 0;
    const preventNativeNavigation = (event: Event): void => {
      nativeSubmits += 1;
      event.preventDefault();
    };
    document.addEventListener("submit", preventNativeNavigation);

    try {
      await act(async () =>
        renderProbe(
          serverForm({
            values: { ...INITIAL_VALUES, email: "ready@example.com" },
          }),
          pushEvent,
          captured,
        ),
      );
      const submitPromise = captured.current!.submit();
      const rejection = expect(submitPromise).rejects.toBeInstanceOf(
        LiveFormSubmitCancelledError,
      );
      await act(async () => connection.setDisconnected());
      await rejection;
      await act(async () => connection.setConnected());
      expect(nativeSubmits).toBe(1);
      expect(captured.current?.submitting).toBe(false);
    } finally {
      document.removeEventListener("submit", preventNativeNavigation);
    }
  });

  it("does not duplicate debounced validation in StrictMode or apply a late ack", async () => {
    vi.useFakeTimers();
    const request = createDeferred<unknown>();
    const pushEvent = vi.fn(() => request.promise) as PushEvent;
    const captured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    await act(async () =>
      renderProbe(serverForm(), pushEvent, captured, 25, undefined, true),
    );

    await act(async () => {
      captured.current?.setValue(["email"], "strict@example.com");
      vi.advanceTimersByTime(25);
    });
    expect(pushEvent).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    rootMounted = false;
    await act(async () => request.resolve({}));
    expect(pushEvent).toHaveBeenCalledTimes(1);
  });
});
