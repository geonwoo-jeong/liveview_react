import { createContext, useContext, type ReactNode } from "react";

import type { LiveViewReactContextValue } from "./types";

const LiveViewReactContext = createContext<LiveViewReactContextValue | null>(
  null,
);

interface LiveViewReactProviderProps {
  readonly children?: ReactNode;
  readonly value: LiveViewReactContextValue;
}

export function LiveViewReactProvider({
  children,
  value,
}: LiveViewReactProviderProps) {
  return (
    <LiveViewReactContext.Provider value={value}>
      {children}
    </LiveViewReactContext.Provider>
  );
}

export function useLiveViewReact(): LiveViewReactContextValue {
  const context = useContext(LiveViewReactContext);

  if (context === null) {
    throw new Error(
      "useLiveViewReact must be used inside a component mounted by liveview_react",
    );
  }

  return context;
}
