import { useContext, useSyncExternalStore } from "react";

import type { ConnectionSnapshot } from "../runtime/connection";
import { LiveViewConnectionContext } from "../runtime/connection-context";

function useConnectionStore() {
  const store = useContext(LiveViewConnectionContext);

  if (store === null) {
    throw new Error(
      "useLiveConnection must be used inside a component mounted by liveview_react",
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
