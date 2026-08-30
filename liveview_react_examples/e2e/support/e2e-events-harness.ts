export interface IncrementPayload {
  readonly by: number;
  readonly label: string;
}

export type IncrementCallback = (payload: IncrementPayload) => void;

export interface EventsAudit {
  readonly serverEventDeliveries: readonly number[];
}

export interface EventsHarnessApi {
  readonly invokeRetainedIncrement: (payload: IncrementPayload) => void;
  readonly snapshot: () => EventsAudit;
}

interface EventsHarnessWindow {
  __liveViewReactEventsE2E: EventsHarnessApi;
}

let retainedIncrement: IncrementCallback | null | undefined = null;
let serverEventDeliveries: readonly number[] = [];

export function retainIncrementCallback(
  callback: IncrementCallback | undefined,
): void {
  retainedIncrement = callback;
}

export function invokeRetainedIncrement(payload: IncrementPayload): void {
  if (retainedIncrement === null) {
    throw new Error("No retained callback is available");
  }

  retainedIncrement!(payload);
}

export function recordServerEventDelivery(sequence: number): void {
  serverEventDeliveries = [...serverEventDeliveries, sequence];
}

export function snapshotEventsAudit(): EventsAudit {
  return Object.freeze({
    serverEventDeliveries: Object.freeze([...serverEventDeliveries]),
  });
}

if (typeof window !== "undefined") {
  const eventsHarnessApi: EventsHarnessApi = Object.freeze({
    invokeRetainedIncrement,
    snapshot: snapshotEventsAudit,
  });

  (window as unknown as EventsHarnessWindow).__liveViewReactEventsE2E =
    eventsHarnessApi;
}
