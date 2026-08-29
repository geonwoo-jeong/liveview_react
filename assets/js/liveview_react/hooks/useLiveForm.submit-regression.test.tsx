import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveViewReactProvider } from "../context";
import { createConnectionStore } from "../runtime/connection";
import { LiveViewConnectionProvider } from "../runtime/connection-context";
import type { PushEvent } from "../types";
import { LIVE_FORM_SUBMIT_EVENT } from "./live-form-runtime";
import {
  createEventBridge,
  INITIAL_VALUES,
  serverForm,
  setInputValue,
  type EventBridge,
  type SubmitReply,
  type Values,
} from "./useLiveForm.test-support";
import {
  LiveFormSubmitCancelledError,
  useLiveForm,
  type UseLiveFormResult,
} from "./useLiveForm";

function Probe({
  captured,
  snapshot,
}: {
  readonly captured: { current?: UseLiveFormResult<Values, SubmitReply> };
  readonly snapshot: ReturnType<typeof serverForm>;
}) {
  const form = useLiveForm<Values, SubmitReply>(snapshot, {
    changeEvent: "validate",
    debounce: 0,
    submitEvent: "save",
  });
  captured.current = form;

  return (
    <form {...form.formProps}>
      <input {...form.revisionInputProps} />
      <input data-testid="email" {...form.field(["email"]).inputProps} />
    </form>
  );
}

describe("useLiveForm submit events", () => {
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
    vi.useFakeTimers();
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
    bridge: EventBridge,
    captured: { current?: UseLiveFormResult<Values, SubmitReply> },
    strict = false,
  ): void {
    const probe = (
      <LiveViewConnectionProvider store={connection}>
        <LiveViewReactProvider value={bridge.value}>
          <Probe captured={captured} snapshot={snapshot} />
        </LiveViewReactProvider>
      </LiveViewConnectionProvider>
    );
    root.render(strict ? <StrictMode>{probe}</StrictMode> : probe);
  }

  it("settles exactly once from the correlated event after stale validation", async () => {
    const pushEvent = vi.fn(() => Promise.resolve({})) as PushEvent;
    const bridge = createEventBridge(pushEvent);
    const captured: { current?: UseLiveFormResult<Values, SubmitReply> } = {};
    const preventNativeNavigation = (event: Event): void =>
      event.preventDefault();
    document.addEventListener("submit", preventNativeNavigation);

    try {
      await act(async () =>
        renderProbe(serverForm({ required: {} }), bridge, captured),
      );
      const input = target.querySelector<HTMLInputElement>(
        '[data-testid="email"]',
      );
      if (!input) throw new Error("Expected email field");

      await act(async () => {
        setInputValue(input, "slow@example.com");
        vi.runOnlyPendingTimers();
        setInputValue(input, "fresh@example.com");
        vi.runOnlyPendingTimers();
      });
      await act(async () =>
        renderProbe(
          serverForm({
            revision: 2,
            values: { ...INITIAL_VALUES, email: "fresh@example.com" },
          }),
          bridge,
          captured,
        ),
      );
      await act(async () =>
        renderProbe(
          serverForm({
            errors: { email: ["slow error"] },
            revision: 1,
            valid: false,
            values: { ...INITIAL_VALUES, email: "slow@example.com" },
          }),
          bridge,
          captured,
        ),
      );
      expect(captured.current).toMatchObject({
        revision: 2,
        valid: true,
        values: { email: "fresh@example.com" },
      });

      await act(async () => {
        setInputValue(input, "invalid@example.com");
        vi.runOnlyPendingTimers();
      });
      await act(async () =>
        renderProbe(
          serverForm({
            errors: { email: ["is invalid"] },
            revision: 3,
            valid: false,
            values: { ...INITIAL_VALUES, email: "invalid@example.com" },
          }),
          bridge,
          captured,
        ),
      );
      await act(async () => {
        setInputValue(input, "saved@example.com");
        vi.runOnlyPendingTimers();
      });
      await act(async () =>
        renderProbe(
          serverForm({
            revision: 4,
            values: { ...INITIAL_VALUES, email: "saved@example.com" },
          }),
          bridge,
          captured,
        ),
      );

      let settlementCount = 0;
      let submitPromise!: Promise<SubmitReply>;
      await act(async () => {
        submitPromise = captured.current!.submit().then((reply) => {
          settlementCount += 1;
          return reply;
        });
      });
      await act(async () => {
        bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "other-form",
          name: "profile",
          reply: { saved: true },
          revision: 4,
        });
        bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "profile-form",
          name: "profile",
          reply: { saved: true },
          revision: 3,
        });
      });
      expect(captured.current?.submitting).toBe(true);
      expect(settlementCount).toBe(0);

      await act(async () =>
        bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "profile-form",
          name: "profile",
          reply: { saved: true },
          revision: 4,
        }),
      );
      await expect(submitPromise).resolves.toEqual({ saved: true });
      expect(captured.current?.submitting).toBe(false);
      expect(settlementCount).toBe(1);

      await act(async () =>
        bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "profile-form",
          name: "profile",
          reply: null,
          revision: 5,
        }),
      );
      expect(captured.current?.submitReply).toEqual({ saved: true });
      expect(settlementCount).toBe(1);
    } finally {
      document.removeEventListener("submit", preventNativeNavigation);
    }
  });

  it("rejects an active submit on a malformed event without throwing globally", async () => {
    const pushEvent = vi.fn(() => Promise.resolve({})) as PushEvent;
    const bridge = createEventBridge(pushEvent);
    const captured: { current?: UseLiveFormResult<Values, SubmitReply> } = {};
    const preventNativeNavigation = (event: Event): void =>
      event.preventDefault();
    document.addEventListener("submit", preventNativeNavigation);

    try {
      await act(async () =>
        renderProbe(serverForm({ required: {} }), bridge, captured),
      );
      const submitPromise = captured.current!.submit();
      const rejection = expect(submitPromise).rejects.toThrow(/unknown key/i);

      await act(async () => {
        bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          extra: true,
          id: "another-form",
          name: "another",
        });
      });
      expect(captured.current?.submitting).toBe(true);

      await act(async () => {
        expect(() =>
          bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
            extra: true,
            id: "profile-form",
            name: "profile",
            reply: { saved: true },
            revision: 0,
          }),
        ).not.toThrow();
      });
      await rejection;
      expect(captured.current?.submitting).toBe(false);
      expect(captured.current?.submitError).toBeInstanceOf(TypeError);
    } finally {
      document.removeEventListener("submit", preventNativeNavigation);
    }
  });

  it("removes the fixed event subscription and rejects submit on unmount", async () => {
    const pushEvent = vi.fn(() => Promise.resolve({})) as PushEvent;
    const bridge = createEventBridge(pushEvent);
    const captured: { current?: UseLiveFormResult<Values, SubmitReply> } = {};
    const preventNativeNavigation = (event: Event): void =>
      event.preventDefault();
    document.addEventListener("submit", preventNativeNavigation);

    try {
      await act(async () =>
        renderProbe(serverForm({ required: {} }), bridge, captured, true),
      );
      expect(bridge.handleEvent).toHaveBeenCalledWith(
        LIVE_FORM_SUBMIT_EVENT,
        expect.any(Function),
      );
      const submitPromise = captured.current!.submit();
      const rejection = expect(submitPromise).rejects.toBeInstanceOf(
        LiveFormSubmitCancelledError,
      );

      await act(async () => root.unmount());
      rootMounted = false;
      await rejection;
      expect(bridge.handleEvent).toHaveBeenCalledTimes(2);
      expect(bridge.removeHandleEvent).toHaveBeenCalledTimes(2);
      expect(() =>
        bridge.emit(LIVE_FORM_SUBMIT_EVENT, {
          id: "profile-form",
          name: "profile",
          reply: null,
          revision: 0,
        }),
      ).not.toThrow();
    } finally {
      document.removeEventListener("submit", preventNativeNavigation);
    }
  });
});
