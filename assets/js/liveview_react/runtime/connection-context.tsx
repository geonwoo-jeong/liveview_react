import { createContext, type ReactNode } from "react";

import type { ConnectionStore } from "./connection";

export const LiveViewConnectionContext = createContext<ConnectionStore | null>(
  null,
);

interface LiveViewConnectionProviderProps {
  readonly children?: ReactNode;
  readonly store: ConnectionStore;
}

export function LiveViewConnectionProvider({
  children,
  store,
}: LiveViewConnectionProviderProps) {
  return (
    <LiveViewConnectionContext.Provider value={store}>
      {children}
    </LiveViewConnectionContext.Provider>
  );
}
