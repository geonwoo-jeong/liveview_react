import { createLiveViewReactHook } from "./hooks";
import type { LiveViewReactHookDefinition } from "./hooks";
import { normalizeRegistry } from "./registry";
import type { ComponentRegistry } from "./types";

export { Link } from "./link";
export { useLiveViewReact } from "./context";
export type { LinkProps } from "./link";
export type { LiveViewReactHookDefinition } from "./hooks";
export type {
  ComponentProps,
  ComponentRegistry,
  ComponentRegistryEntry,
  EagerComponentEntry,
  EventPayload,
  EventReplyHandler,
  HandleEvent,
  LazyComponentEntry,
  LazyComponentModule,
  LiveViewReactComponent,
  LiveViewReactContextValue,
  PushEvent,
  PushEventTo,
  RemoveHandleEvent,
  SlotMap,
  Upload,
  UploadFiles,
  UploadTo,
} from "./types";

export interface CreateLiveViewReactOptions {
  readonly components: ComponentRegistry;
}

export interface LiveViewReactHooks {
  readonly LiveViewReactHook: LiveViewReactHookDefinition;
}

export interface LiveViewReact {
  readonly hooks: LiveViewReactHooks;
}

export function createLiveViewReact({
  components,
}: CreateLiveViewReactOptions): LiveViewReact {
  const registry = normalizeRegistry(components);

  return Object.freeze({
    hooks: Object.freeze({
      LiveViewReactHook: createLiveViewReactHook(registry),
    }),
  });
}
