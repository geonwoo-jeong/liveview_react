type EncodedJsCommand = string | readonly unknown[];

export interface LiveSocketJSCommands {
  readonly exec: (element: HTMLElement, encodedJS: EncodedJsCommand) => void;
  readonly navigate: (
    href: string,
    options?: { readonly replace?: boolean },
  ) => void;
  readonly patch: (
    href: string,
    options?: { readonly replace?: boolean },
  ) => void;
}

export function readLiveSocketCommands(
  liveSocket: unknown,
): LiveSocketJSCommands | null {
  if (typeof liveSocket !== "object" || liveSocket === null) return null;
  if (!("js" in liveSocket) || typeof liveSocket.js !== "function") return null;

  return liveSocket.js();
}
