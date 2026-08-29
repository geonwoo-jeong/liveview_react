export interface ConnectionSnapshot {
  readonly connected: boolean;
  readonly reconnecting: boolean;
}

export interface ConnectionStore {
  readonly destroy: () => void;
  readonly getServerSnapshot: () => ConnectionSnapshot;
  readonly getSnapshot: () => ConnectionSnapshot;
  readonly setConnected: () => void;
  readonly setDisconnected: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

const CONNECTED_SNAPSHOT: ConnectionSnapshot = Object.freeze({
  connected: true,
  reconnecting: false,
});

const DISCONNECTED_SNAPSHOT: ConnectionSnapshot = Object.freeze({
  connected: false,
  reconnecting: true,
});

const SERVER_SNAPSHOT: ConnectionSnapshot = Object.freeze({
  connected: false,
  reconnecting: false,
});

const noop = (): void => undefined;

interface Subscription {
  readonly listener: () => void;
}

export function createConnectionStore(): ConnectionStore {
  let destroyed = false;
  let snapshot = CONNECTED_SNAPSHOT;
  let subscriptions: readonly Subscription[] = [];

  const transition = (nextSnapshot: ConnectionSnapshot): void => {
    if (destroyed || snapshot === nextSnapshot) return;

    snapshot = nextSnapshot;
    for (const { listener } of subscriptions) listener();
  };

  return Object.freeze({
    destroy(): void {
      if (destroyed) return;

      destroyed = true;
      subscriptions = [];
    },
    getServerSnapshot(): ConnectionSnapshot {
      return SERVER_SNAPSHOT;
    },
    getSnapshot(): ConnectionSnapshot {
      return snapshot;
    },
    setConnected(): void {
      transition(CONNECTED_SNAPSHOT);
    },
    setDisconnected(): void {
      transition(DISCONNECTED_SNAPSHOT);
    },
    subscribe(listener: () => void): () => void {
      if (destroyed) return noop;

      const subscription = Object.freeze({ listener });
      subscriptions = [...subscriptions, subscription];
      let subscribed = true;

      return (): void => {
        if (!subscribed) return;

        subscribed = false;
        subscriptions = subscriptions.filter(
          (candidate) => candidate !== subscription,
        );
      };
    },
  });
}
