import { createLiveViewReactHook } from "./hooks";
import type { LiveViewReactHookDefinition } from "./hooks";
import {
  LiveEventReplyCancelledError,
  LiveEventReplyTimeoutError,
  useEventReply,
  type UseEventReplyOptions,
  type UseEventReplyResult,
} from "./hooks/useEventReply";
import { useLiveConnection } from "./hooks/useLiveConnection";
import { useLiveEvent } from "./hooks/useLiveEvent";
import {
  useLiveNavigation,
  type LiveNavigation,
  type LiveNavigationOptions,
} from "./hooks/useLiveNavigation";
import { useLiveReact } from "./hooks/useLiveReact";
import "./react-phx";
import { normalizeRegistry } from "./registry";
import type { ConnectionSnapshot } from "./runtime/connection";
import { normalizeRootOptions } from "./runtime/options";
import type { ComponentRegistry, LiveViewReactRootOptions } from "./types";

export { Link } from "./link";
export type { LinkProps } from "./link";
export type { LiveViewReactHookDefinition } from "./hooks";
export type { ConnectionSnapshot };
export type {
  ComponentProps,
  ComponentRegistry,
  ComponentRegistryEntry,
  EagerComponentEntry,
  EventPayload,
  HandleEvent,
  LazyComponentEntry,
  LazyComponentModule,
  LiveViewTarget,
  LiveViewReactComponent,
  LiveViewReactContextValue,
  LiveViewReactRootOptions,
  LiveViewReactRootWrapper,
  LiveViewReactRootWrapperContext,
  PushEvent,
  PushEventTo,
  RemoveHandleEvent,
  SlotMap,
  TargetedEventReply,
  Upload,
  UploadFiles,
  UploadTo,
} from "./types";
export {
  LiveEventReplyCancelledError,
  LiveEventReplyTimeoutError,
  useEventReply,
  useLiveConnection,
  useLiveEvent,
  useLiveNavigation,
  useLiveReact,
};
export type {
  LiveNavigation,
  LiveNavigationOptions,
  UseEventReplyOptions,
  UseEventReplyResult,
};

export interface CreateLiveViewReactOptions extends LiveViewReactRootOptions {
  readonly components: ComponentRegistry;
}

export interface LiveViewReactHooks {
  readonly LiveViewReactHook: LiveViewReactHookDefinition;
}

export interface LiveViewReact {
  readonly hooks: LiveViewReactHooks;
}

export function createLiveViewReact(
  options: CreateLiveViewReactOptions,
): LiveViewReact {
  const { components, rootOptions } = normalizeRootOptions(options, "client");
  const registry = normalizeRegistry(components);

  return Object.freeze({
    hooks: Object.freeze({
      LiveViewReactHook: createLiveViewReactHook(registry, rootOptions),
    }),
  });
}
