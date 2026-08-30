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

export function useOptionalLiveViewReact(): LiveViewReactContextValue | null {
  return useContext(LiveViewReactContext);
}

export function useLiveViewReact(): LiveViewReactContextValue {
  const context = useOptionalLiveViewReact();

  if (context === null) {
    throw new Error(
      "useLiveViewReact requires the LiveViewReact context and must be called from a component rendered inside a LiveViewReact root",
    );
  }

  return context;
}
