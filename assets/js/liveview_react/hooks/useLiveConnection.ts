import { useContext, useSyncExternalStore } from "react";

import type { ConnectionSnapshot } from "../runtime/connection";
import { LiveViewConnectionContext } from "../runtime/connection-context";

function useConnectionStore() {
  const store = useContext(LiveViewConnectionContext);

  if (store === null) {
    throw new Error(
      "useLiveConnection requires the LiveViewReact connection store and must be called from a component rendered inside a LiveViewReact root",
    );
  }

  return store;
}

export function useLiveConnection(): ConnectionSnapshot {
  const store = useConnectionStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
