import type { LiveViewReactContextValue } from "../types";

function unavailableDuringServerRenderOrHydration(): never {
  throw new Error(
    "LiveView bridge methods are unavailable during server rendering or hydration",
  );
}

export const SERVER_BRIDGE_CONTEXT: LiveViewReactContextValue = Object.freeze({
  el: null,
  liveSocket: null,
  pushEvent: unavailableDuringServerRenderOrHydration,
  pushEventTo: unavailableDuringServerRenderOrHydration,
  handleEvent: unavailableDuringServerRenderOrHydration,
  removeHandleEvent: unavailableDuringServerRenderOrHydration,
  upload: unavailableDuringServerRenderOrHydration,
  uploadTo: unavailableDuringServerRenderOrHydration,
});
