import type {
  HandleEvent,
  LiveViewReactContextValue,
  PushEvent,
  PushEventTo,
  RemoveHandleEvent,
  Upload,
  UploadTo,
} from "../types";

export interface LiveViewHookHost {
  readonly el: HTMLElement;
  readonly liveSocket?: unknown;
  readonly pushEvent: PushEvent;
  readonly pushEventTo: PushEventTo;
  readonly handleEvent: HandleEvent;
  readonly removeHandleEvent: RemoveHandleEvent;
  readonly upload: Upload;
  readonly uploadTo: UploadTo;
}

export function createLiveViewBridge(
  hook: LiveViewHookHost,
): LiveViewReactContextValue {
  return Object.freeze({
    el: hook.el,
    liveSocket: hook.liveSocket ?? null,
    pushEvent: hook.pushEvent.bind(hook),
    pushEventTo: hook.pushEventTo.bind(hook),
    handleEvent: hook.handleEvent.bind(hook),
    removeHandleEvent: hook.removeHandleEvent.bind(hook),
    upload: hook.upload.bind(hook),
    uploadTo: hook.uploadTo.bind(hook),
  });
}
