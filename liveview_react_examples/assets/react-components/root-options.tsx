import { createContext, useContext } from "react";
import type { LiveViewReactRootOptions } from "liveview_react";

const SampleRootContext = createContext("unwrapped");

function wrapRoot({
  children,
  componentName,
}: Parameters<NonNullable<LiveViewReactRootOptions["wrapRoot"]>>[0]) {
  return (
    <SampleRootContext.Provider value={componentName}>
      {children}
    </SampleRootContext.Provider>
  );
}

function reportRootError(kind: string, error: unknown, info: unknown) {
  window.dispatchEvent(
    new CustomEvent("liveview-react:root-error", {
      detail: Object.freeze({ error, info, kind }),
    }),
  );
}

const onCaughtError: NonNullable<LiveViewReactRootOptions["onCaughtError"]> = (
  error,
  info,
) => {
  reportRootError("caught", error, info);
};

const onRecoverableError: NonNullable<
  LiveViewReactRootOptions["onRecoverableError"]
> = (error, info) => {
  reportRootError("recoverable", error, info);
};

const onUncaughtError: NonNullable<
  LiveViewReactRootOptions["onUncaughtError"]
> = (error, info) => {
  reportRootError("uncaught", error, info);
};

export function useSampleRootName() {
  return useContext(SampleRootContext);
}

export const serverRootOptions = Object.freeze({
  strictMode: true,
  wrapRoot,
}) satisfies LiveViewReactRootOptions;

export const clientRootOptions = Object.freeze({
  ...serverRootOptions,
  onCaughtError,
  onRecoverableError,
  onUncaughtError,
}) satisfies LiveViewReactRootOptions;
