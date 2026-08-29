// Browser-only audit state for the deterministic lifecycle suite.
const emptyProbe = Object.freeze({ mounts: 0, cleanups: 0 });

let audit = Object.freeze({
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
});

let pendingLazy = Object.freeze({
  update: Object.freeze([]),
  destroy: Object.freeze([]),
});
let tracedRootId = null;
let corruptPropsRootId = null;

function replaceProbe(label, update) {
  const current = audit.probes[label] ?? emptyProbe;
  const next = Object.freeze(update(current));

  audit = Object.freeze({
    ...audit,
    probes: Object.freeze({ ...audit.probes, [label]: next }),
  });

  return next;
}

function replaceLazy(gate, update) {
  audit = Object.freeze({
    ...audit,
    lazy: Object.freeze({
      ...audit.lazy,
      [gate]: Object.freeze(update(audit.lazy[gate])),
    }),
  });
}

function replaceStrict(update) {
  audit = Object.freeze({
    ...audit,
    strict: Object.freeze(update(audit.strict)),
  });
}

function snapshot() {
  return JSON.parse(JSON.stringify(audit));
}

function startReconnectTrace(rootId) {
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new TypeError("Reconnect trace requires a non-empty root id");
  }

  tracedRootId = rootId;
  audit = Object.freeze({
    ...audit,
    hookCallbacks: Object.freeze([]),
  });
}

function corruptNextPropsPatch(rootId) {
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new TypeError("Patch corruption requires a non-empty root id");
  }

  corruptPropsRootId = rootId;
}

function applyScheduledCorruption(lifecycle, element) {
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

function recordHookCallback(lifecycle, element) {
  if (element.id !== tracedRootId) return;

  const authoritativeQueuedCount = document.querySelector(
    '[data-testid="authoritative-queued-count"]',
  )?.textContent;
  const entry = Object.freeze({
    lifecycle,
    propsKind: element.getAttribute("data-props-kind"),
    authoritativeQueuedCount: authoritativeQueuedCount ?? null,
  });

  audit = Object.freeze({
    ...audit,
    hookCallbacks: Object.freeze([...audit.hookCallbacks, entry]),
  });
}

function recordHydrationMount(element) {
  const target = element.querySelector(":scope > [data-react-target]");
  const input = target?.querySelector("input");
  const entry = Object.freeze({
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

async function resolveLazy(gate) {
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
  Object.defineProperty(window, "__liveViewReactE2E", {
    configurable: true,
    value: Object.freeze({
      corruptNextPropsPatch,
      resolveLazy,
      snapshot,
      startReconnectTrace,
    }),
  });
}

function wrapHookCallback(hook, lifecycle) {
  return function (...args) {
    applyScheduledCorruption(lifecycle, this.el);
    recordHookCallback(lifecycle, this.el);
    return hook[lifecycle].apply(this, args);
  };
}

function wrapHookMount(hook) {
  return function (...args) {
    recordHydrationMount(this.el);
    return hook.mounted.apply(this, args);
  };
}

export function auditLiveViewReactHook(hook) {
  return Object.freeze({
    ...hook,
    mounted: wrapHookMount(hook),
    updated: wrapHookCallback(hook, "updated"),
    disconnected: wrapHookCallback(hook, "disconnected"),
    reconnected: wrapHookCallback(hook, "reconnected"),
  });
}

export function createDelayedLoader(gate, importer) {
  return () =>
    new Promise((resolve, reject) => {
      const release = async () => {
        try {
          const loaded = await importer();
          replaceLazy(gate, (current) => ({
            ...current,
            resolved: current.resolved + 1,
          }));
          resolve(loaded);
        } catch (error) {
          reject(error);
        }
      };
      const releases = Object.freeze([...pendingLazy[gate], release]);

      pendingLazy = Object.freeze({ ...pendingLazy, [gate]: releases });
      replaceLazy(gate, (current) => ({
        ...current,
        requests: current.requests + 1,
        pending: releases.length,
      }));
    });
}

export function recordProbeMount(label) {
  const next = replaceProbe(label, (current) => ({
    ...current,
    mounts: current.mounts + 1,
  }));

  return `${label}-${next.mounts}`;
}

export function recordProbeCleanup(label) {
  replaceProbe(label, (current) => ({
    ...current,
    cleanups: current.cleanups + 1,
  }));
}

export function recordStrictRegistration() {
  replaceStrict((current) => ({
    ...current,
    registrations: current.registrations + 1,
    activeListeners: current.activeListeners + 1,
  }));
}

export function recordStrictRemoval() {
  replaceStrict((current) => ({
    ...current,
    removals: current.removals + 1,
    activeListeners: current.activeListeners - 1,
  }));
}

export function recordStrictDelivery() {
  replaceStrict((current) => ({
    ...current,
    deliveries: current.deliveries + 1,
  }));
}
