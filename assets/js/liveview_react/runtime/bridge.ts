import type {
  HandleEvent,
  LiveViewReactContextValue,
  PushEvent,
  PushEventTo,
  RemoveHandleEvent,
  Upload,
  UploadTo,
} from "../types";
import type { EventCommandExecutor } from "./event-callbacks";

interface LiveViewHookJsCommands {
  readonly exec: (commands: readonly unknown[]) => void;
}

export interface LiveViewHookHost {
  readonly el: HTMLElement;
  readonly js: () => LiveViewHookJsCommands;
  readonly liveSocket?: unknown;
  readonly pushEvent: PushEvent;
  readonly pushEventTo: PushEventTo;
  readonly handleEvent: HandleEvent;
  readonly removeHandleEvent: RemoveHandleEvent;
  readonly upload: Upload;
  readonly uploadTo: UploadTo;
}

export function createHookEventExecutor(
  hook: LiveViewHookHost,
): EventCommandExecutor {
  return (commands) => {
    const hookCommands = hook.js();
    if (
      typeof hookCommands !== "object" ||
      hookCommands === null ||
      typeof hookCommands.exec !== "function"
    ) {
      throw new Error(
        "React event callbacks require the LiveView Hook public js().exec API",
      );
    }

    hookCommands.exec(commands);
  };
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
