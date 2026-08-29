let retainedIncrement = null;
let serverEventDeliveries = [];

export function retainIncrementCallback(callback) {
  retainedIncrement = callback;
}

export function invokeRetainedIncrement(payload) {
  if (retainedIncrement === null) {
    throw new Error("No retained callback is available");
  }

  retainedIncrement(payload);
}

export function recordServerEventDelivery(sequence) {
  serverEventDeliveries = [...serverEventDeliveries, sequence];
}

export function snapshotEventsAudit() {
  return Object.freeze({
    serverEventDeliveries: Object.freeze([...serverEventDeliveries]),
  });
}

if (typeof window !== "undefined") {
  window.__liveViewReactEventsE2E = Object.freeze({
    invokeRetainedIncrement,
    snapshot: snapshotEventsAudit,
  });
}
