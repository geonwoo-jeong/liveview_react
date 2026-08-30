import type { LiveViewReactHookDefinition } from "liveview_react";

declare const __LIVEVIEW_REACT_E2E__: boolean;

export type LazyGate = "destroy" | "update";
export type AuditedHookLifecycle = "disconnected" | "reconnected" | "updated";
export type RootErrorKind = "caught" | "recoverable" | "uncaught";

export interface ProbeAudit {
  readonly cleanups: number;
  readonly mounts: number;
}

export interface LazyAudit {
  readonly pending: number;
  readonly requests: number;
  readonly resolved: number;
}

export interface StrictAudit {
  readonly activeListeners: number;
  readonly deliveries: number;
  readonly registrations: number;
  readonly removals: number;
}

export interface HydrationMountAudit {
  readonly childElementCount: number;
  readonly descriptorPresent: boolean;
  readonly inputId: string | null;
  readonly rootId: string;
}

export interface HookCallbackAudit {
  readonly authoritativeQueuedCount: string | null;
  readonly lifecycle: AuditedHookLifecycle;
  readonly propsKind: string | null;
}

export interface DestroyedCallbackAudit {
  readonly elementConnected: boolean;
  readonly elementId: string;
  readonly mainConnected: boolean | null;
  readonly mainLoading: boolean | null;
  readonly mainPresent: boolean;
}

export interface RootErrorAudit {
  readonly componentStack: string | null;
  readonly kind: RootErrorKind;
  readonly message: string;
  readonly name: string;
}

export interface LifecycleAudit {
  readonly destroyedCallbacks: readonly DestroyedCallbackAudit[];
  readonly hookCallbacks: readonly HookCallbackAudit[];
  readonly hydrationMounts: readonly HydrationMountAudit[];
  readonly lazy: Readonly<Record<LazyGate, LazyAudit>>;
  readonly probes: Readonly<Record<string, ProbeAudit>>;
  readonly rootErrors: readonly RootErrorAudit[];
  readonly strict: StrictAudit;
  readonly transport: Readonly<{ corruptions: number }>;
}

export interface E2EHarnessApi {
  readonly corruptNextPropsPatch: (rootId: string) => void;
  readonly resolveLazy: (gate: LazyGate) => Promise<number>;
  readonly snapshot: () => LifecycleAudit;
  readonly startReconnectTrace: (rootId: string) => void;
}

interface RootErrorInfo {
  readonly componentStack?: unknown;
}

type StateUpdater<T> = (current: T) => T;
type LazyRelease = () => Promise<void>;
type PendingLazy = Readonly<Record<LazyGate, readonly LazyRelease[]>>;
type HookHost = ThisParameterType<LiveViewReactHookDefinition["mounted"]>;
type HookMethod = (this: HookHost, ...args: unknown[]) => void;

// Browser-only audit state for the deterministic lifecycle suite.
const emptyProbe: ProbeAudit = Object.freeze({ mounts: 0, cleanups: 0 });

let audit: LifecycleAudit = Object.freeze({
  probes: Object.freeze({}),
  lazy: Object.freeze({
    update: Object.freeze({ requests: 0, pending: 0, resolved: 0 }),
    destroy: Object.freeze({ requests: 0, pending: 0, resolved: 0 }),
  }),
  strict: Object.freeze({
    registrations: 0,
    removals: 0,
    activeListeners: 0,
    deliveries: 0,
  }),
  hydrationMounts: Object.freeze([]),
  transport: Object.freeze({ corruptions: 0 }),
  hookCallbacks: Object.freeze([]),
  destroyedCallbacks: Object.freeze([]),
  rootErrors: Object.freeze([]),
});

let pendingLazy: PendingLazy = Object.freeze({
  update: Object.freeze([]),
  destroy: Object.freeze([]),
});
let tracedRootId: string | null = null;
let corruptPropsRootId: string | null = null;

function replaceProbe(
  label: string,
  update: StateUpdater<ProbeAudit>,
): ProbeAudit {
  const current = audit.probes[label] ?? emptyProbe;
  const next: ProbeAudit = Object.freeze(update(current));

  audit = Object.freeze({
    ...audit,
    probes: Object.freeze({ ...audit.probes, [label]: next }),
  });

  return next;
}

function replaceLazy(gate: LazyGate, update: StateUpdater<LazyAudit>): void {
  audit = Object.freeze({
    ...audit,
    lazy: Object.freeze({
      ...audit.lazy,
      [gate]: Object.freeze(update(audit.lazy[gate])),
    }),
  });
}

function replaceStrict(update: StateUpdater<StrictAudit>): void {
  audit = Object.freeze({
    ...audit,
    strict: Object.freeze(update(audit.strict)),
  });
}

function snapshot(): LifecycleAudit {
  return JSON.parse(JSON.stringify(audit)) as LifecycleAudit;
}

function startReconnectTrace(rootId: string): void {
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new TypeError("Reconnect trace requires a non-empty root id");
  }

  tracedRootId = rootId;
  audit = Object.freeze({
    ...audit,
    hookCallbacks: Object.freeze([]),
  });
}

function corruptNextPropsPatch(rootId: string): void {
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new TypeError("Patch corruption requires a non-empty root id");
  }

  corruptPropsRootId = rootId;
}

function applyScheduledCorruption(
  lifecycle: AuditedHookLifecycle,
  element: HTMLElement,
): void {
  if (
    lifecycle !== "updated" ||
    element.id !== corruptPropsRootId ||
    element.getAttribute("data-props-kind") !== "patch"
  ) {
    return;
  }

  corruptPropsRootId = null;
  element.setAttribute("data-props-diff", "r999:/corrupted");
  audit = Object.freeze({
    ...audit,
    transport: Object.freeze({
      corruptions: audit.transport.corruptions + 1,
    }),
  });
}

function recordHookCallback(
  lifecycle: AuditedHookLifecycle,
  element: HTMLElement,
): void {
  if (element.id !== tracedRootId) return;

  const authoritativeQueuedCount = document.querySelector(
    '[data-testid="authoritative-queued-count"]',
  )?.textContent;
  const entry: HookCallbackAudit = Object.freeze({
    lifecycle,
    propsKind: element.getAttribute("data-props-kind"),
    authoritativeQueuedCount: authoritativeQueuedCount ?? null,
  });

  audit = Object.freeze({
    ...audit,
    hookCallbacks: Object.freeze([...audit.hookCallbacks, entry]),
  });
}

function recordDestroyedCallback(element: HTMLElement): void {
  const main = element.closest("[data-phx-main]");
  const entry: DestroyedCallbackAudit = Object.freeze({
    elementConnected: element.isConnected,
    elementId: element.id,
    mainConnected: main instanceof HTMLElement ? main.isConnected : null,
    mainLoading:
      main instanceof HTMLElement
        ? main.classList.contains("phx-loading")
        : null,
    mainPresent: main instanceof HTMLElement,
  });

  audit = Object.freeze({
    ...audit,
    destroyedCallbacks: Object.freeze([...audit.destroyedCallbacks, entry]),
  });
}

function recordHydrationMount(element: HTMLElement): void {
  const target = element.querySelector<HTMLElement>(
    ":scope > [data-react-target]",
  );
  const input = target?.querySelector<HTMLInputElement>("input");
  const entry: HydrationMountAudit = Object.freeze({
    rootId: element.id,
    descriptorPresent: target?.hasAttribute("data-react-hydration") ?? false,
    childElementCount: target?.childElementCount ?? -1,
    inputId: input?.id ?? null,
  });

  audit = Object.freeze({
    ...audit,
    hydrationMounts: Object.freeze([...audit.hydrationMounts, entry]),
  });
}

async function resolveLazy(gate: LazyGate): Promise<number> {
  const releases = pendingLazy[gate];
  if (!releases) throw new Error(`Unknown lazy gate: ${gate}`);

  pendingLazy = Object.freeze({
    ...pendingLazy,
    [gate]: Object.freeze([]),
  });
  replaceLazy(gate, (current) => ({ ...current, pending: 0 }));

  await Promise.all(releases.map((release) => release()));
  await Promise.resolve();

  return releases.length;
}

if (__LIVEVIEW_REACT_E2E__ && typeof window !== "undefined") {
  const e2eHarnessApi: E2EHarnessApi = Object.freeze({
    corruptNextPropsPatch,
    resolveLazy,
    snapshot,
    startReconnectTrace,
  });

  Object.defineProperty(window, "__liveViewReactE2E", {
    configurable: true,
    value: e2eHarnessApi,
  });
}

function hookMethod(
  hook: LiveViewReactHookDefinition,
  lifecycle: keyof LiveViewReactHookDefinition,
): HookMethod {
  return hook[lifecycle] as HookMethod;
}

function wrapHookCallback(
  hook: LiveViewReactHookDefinition,
  lifecycle: AuditedHookLifecycle,
): HookMethod {
  return function (this: HookHost, ...args: unknown[]): void {
    applyScheduledCorruption(lifecycle, this.el);
    recordHookCallback(lifecycle, this.el);
    return hookMethod(hook, lifecycle).apply(this, args);
  };
}

function wrapHookMount(hook: LiveViewReactHookDefinition): HookMethod {
  return function (this: HookHost, ...args: unknown[]): void {
    recordHydrationMount(this.el);
    return hookMethod(hook, "mounted").apply(this, args);
  };
}

export function auditLiveViewReactHook(
  hook: LiveViewReactHookDefinition,
): LiveViewReactHookDefinition {
  return Object.freeze({
    ...hook,
    mounted: wrapHookMount(hook),
    updated: wrapHookCallback(hook, "updated"),
    disconnected: wrapHookCallback(hook, "disconnected"),
    reconnected: wrapHookCallback(hook, "reconnected"),
    destroyed(this: HookHost, ...args: unknown[]): void {
      recordDestroyedCallback(this.el);
      return hookMethod(hook, "destroyed").apply(this, args);
    },
  });
}

export function createDelayedLoader<T>(
  gate: LazyGate,
  importer: () => Promise<T>,
): () => Promise<T> {
  return () =>
    new Promise<T>((resolve, reject) => {
      const release = async (): Promise<void> => {
        try {
          const loaded = await importer();
          replaceLazy(gate, (current) => ({
            ...current,
            resolved: current.resolved + 1,
          }));
          resolve(loaded);
        } catch (error: unknown) {
          reject(error);
        }
      };
      const releases: readonly LazyRelease[] = Object.freeze([
        ...pendingLazy[gate],
        release,
      ]);

      pendingLazy = Object.freeze({ ...pendingLazy, [gate]: releases });
      replaceLazy(gate, (current) => ({
        ...current,
        requests: current.requests + 1,
        pending: releases.length,
      }));
    });
}

export function recordProbeMount(label: string): string {
  const next = replaceProbe(label, (current) => ({
    ...current,
    mounts: current.mounts + 1,
  }));

  return `${label}-${next.mounts}`;
}

export function recordProbeCleanup(label: string): void {
  replaceProbe(label, (current) => ({
    ...current,
    cleanups: current.cleanups + 1,
  }));
}

export function recordRootError(
  kind: RootErrorKind,
  error: unknown,
  info: RootErrorInfo | null | undefined,
): RootErrorAudit {
  const entry: RootErrorAudit = Object.freeze({
    kind,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    componentStack:
      typeof info?.componentStack === "string" ? info.componentStack : null,
  });

  audit = Object.freeze({
    ...audit,
    rootErrors: Object.freeze([...audit.rootErrors, entry]),
  });

  return entry;
}

export function recordStrictRegistration(): void {
  replaceStrict((current) => ({
    ...current,
    registrations: current.registrations + 1,
    activeListeners: current.activeListeners + 1,
  }));
}

export function recordStrictRemoval(): void {
  replaceStrict((current) => ({
    ...current,
    removals: current.removals + 1,
    activeListeners: current.activeListeners - 1,
  }));
}

export function recordStrictDelivery(): void {
  replaceStrict((current) => ({
    ...current,
    deliveries: current.deliveries + 1,
  }));
}
