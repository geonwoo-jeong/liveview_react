import { useLayoutEffect, useMemo, useRef } from "react";

import { useOptionalClientBridge } from "../runtime/client-bridge-context";
import { readLiveSocketCommands } from "../runtime/live-socket";

export interface LiveNavigationOptions {
  readonly replace?: boolean;
}

export interface LiveNavigation {
  readonly navigate: (href: string, options?: LiveNavigationOptions) => void;
  readonly patch: (href: string, options?: LiveNavigationOptions) => void;
}

function requireNavigationCommands(liveSocket: unknown) {
  const commands = readLiveSocketCommands(liveSocket);
  if (
    commands !== null &&
    typeof commands.navigate === "function" &&
    typeof commands.patch === "function"
  ) {
    return commands;
  }

  throw new Error(
    "LiveView navigation is unavailable without a connected LiveView bridge",
  );
}

export function useLiveNavigation(): LiveNavigation {
  const bridge = useOptionalClientBridge();
  const liveSocketRef = useRef(bridge?.liveSocket ?? null);

  useLayoutEffect(() => {
    liveSocketRef.current = bridge?.liveSocket ?? null;
  }, [bridge]);

  return useMemo(
    () =>
      Object.freeze({
        navigate(href: string, options?: LiveNavigationOptions): void {
          requireNavigationCommands(liveSocketRef.current).navigate(
            href,
            options,
          );
        },
        patch(href: string, options?: LiveNavigationOptions): void {
          requireNavigationCommands(liveSocketRef.current).patch(href, options);
        },
      }),
    [],
  );
}
