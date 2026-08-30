import { createContext, useContext, type ReactNode } from "react";

import { useOptionalLiveViewReact } from "../context";
import type { LiveViewReactContextValue } from "../types";

const ClientBridgeContext = createContext<LiveViewReactContextValue | null>(
  null,
);

interface ClientBridgeProviderProps {
  readonly children?: ReactNode;
  readonly value: LiveViewReactContextValue;
}

export function ClientBridgeProvider({
  children,
  value,
}: ClientBridgeProviderProps) {
  return (
    <ClientBridgeContext.Provider value={value}>
      {children}
    </ClientBridgeContext.Provider>
  );
}

export function useOptionalClientBridge(): LiveViewReactContextValue | null {
  const clientBridge = useContext(ClientBridgeContext);
  const publicBridge = useOptionalLiveViewReact();
  return clientBridge ?? publicBridge;
}

export function useRequiredClientBridge(
  hookName: string,
): LiveViewReactContextValue {
  const bridge = useOptionalClientBridge();

  if (bridge === null) {
    throw new Error(
      `${hookName} requires the LiveViewReact context and must be called from a component rendered inside a LiveViewReact root`,
    );
  }

  return bridge;
}
