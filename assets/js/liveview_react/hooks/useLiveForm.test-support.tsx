import type { HTMLAttributes } from "react";
import { vi } from "vitest";

import type { LiveFormServerSnapshot } from "../forms";
import type { LiveViewReactContextValue, PushEvent } from "../types";
import {
  LiveFormSubmitCancelledError,
  useLiveForm,
  type UseLiveFormResult,
} from "./useLiveForm";

export interface Values {
  readonly active: boolean;
  readonly addresses: readonly Readonly<{ city: string }>[];
  readonly birthday: string;
  readonly count: number | null;
  readonly email: string;
  readonly features: readonly string[];
  readonly role: string;
  readonly settings: Readonly<{ theme: string }>;
  readonly tags: readonly string[];
}

export type SubmitReply = Readonly<{ saved: boolean }> | null;

export interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: TValue) => void;
}

export const INITIAL_VALUES: Values = Object.freeze({
  active: false,
  addresses: Object.freeze([Object.freeze({ city: "Tokyo" })]),
  birthday: "",
  count: null,
  email: "",
  features: Object.freeze([]),
  role: "reader",
  settings: Object.freeze({ theme: "dark" }),
  tags: Object.freeze([]),
});

export function serverForm(
  overrides: Partial<LiveFormServerSnapshot<Values>> = {},
): LiveFormServerSnapshot<Values> {
  return {
    errors: {},
    id: "profile-form",
    name: "profile",
    required: { email: true },
    revision: 0,
    valid: true,
    values: INITIAL_VALUES,
    ...overrides,
  };
}

export function createDeferred<TValue>(): Deferred<TValue> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: TValue) => void;
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

export function createBridge(pushEvent: PushEvent): LiveViewReactContextValue {
  return createEventBridge(pushEvent).value;
}

interface EventSubscription {
  readonly callback: CallableFunction;
  readonly event: string;
  readonly reference: object;
}

export interface EventBridge {
  readonly emit: (event: string, payload: unknown) => void;
  readonly handleEvent: ReturnType<typeof vi.fn>;
  readonly removeHandleEvent: ReturnType<typeof vi.fn>;
  readonly value: LiveViewReactContextValue;
}

export function createEventBridge(pushEvent: PushEvent): EventBridge {
  let subscriptions: readonly EventSubscription[] = [];
  const handleEvent = vi.fn();
  function subscribe<TPayload = unknown>(
    event: string,
    callback: (payload: TPayload) => void,
  ): object {
    handleEvent(event, callback);
    const reference = Object.freeze({ event });
    subscriptions = [...subscriptions, { callback, event, reference }];
    return reference;
  }
  const removeHandleEvent = vi.fn((reference: unknown): void => {
    subscriptions = subscriptions.filter(
      (subscription) => subscription.reference !== reference,
    );
  });
  const value: LiveViewReactContextValue = {
    el: document.createElement("div"),
    handleEvent: subscribe,
    liveSocket: null,
    pushEvent,
    pushEventTo: vi.fn(() => Promise.resolve([])),
    removeHandleEvent,
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };

  return Object.freeze({
    emit(event: string, payload: unknown): void {
      for (const subscription of subscriptions) {
        if (subscription.event === event) {
          Reflect.apply(subscription.callback, undefined, [payload]);
        }
      }
    },
    handleEvent,
    removeHandleEvent,
    value: Object.freeze(value),
  });
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export interface FormProbeProps {
  readonly captured: {
    current?: UseLiveFormResult<Values, SubmitReply>;
  };
  readonly debounce: number;
  readonly onParentChange?: HTMLAttributes<HTMLFormElement>["onChange"];
  readonly snapshot: LiveFormServerSnapshot<Values>;
}

export function FormProbe({
  captured,
  debounce,
  onParentChange,
  snapshot,
}: FormProbeProps) {
  const form = useLiveForm<Values, SubmitReply>(snapshot, {
    changeEvent: "validate",
    debounce,
    submitEvent: "save",
  });
  captured.current = form;
  const active = form.field(["active"], { type: "checkbox" });
  const featureAlpha = form.field(["features"], {
    multiple: true,
    type: "checkbox",
    value: "alpha",
  });
  const featureBeta = form.field(["features"], {
    multiple: true,
    type: "checkbox",
    value: "beta",
  });

  return (
    <form {...form.formProps} onChange={onParentChange}>
      <input {...form.revisionInputProps} />
      <input data-testid="email" {...form.field(["email"]).inputProps} />
      <input
        data-testid="city"
        {...form.field(["addresses", 0, "city"]).inputProps}
      />
      {active.hiddenInputProps ? <input {...active.hiddenInputProps} /> : null}
      <input data-testid="active" {...active.inputProps} />
      <input data-testid="feature-alpha" {...featureAlpha.inputProps} />
      <input data-testid="feature-beta" {...featureBeta.inputProps} />
      <input
        data-testid="role-admin"
        {...form.field(["role"], { type: "radio", value: "admin" }).inputProps}
      />
      <input
        data-testid="count"
        {...form.field(["count"], { type: "number" }).inputProps}
      />
      <input
        data-testid="birthday"
        {...form.field(["birthday"], { type: "date" }).inputProps}
      />
      <select
        data-testid="tags"
        multiple
        {...form.field(["tags"], { multiple: true }).inputProps}
      >
        <option value="elixir">Elixir</option>
        <option value="react">React</option>
      </select>
    </form>
  );
}

export { LiveFormSubmitCancelledError };
