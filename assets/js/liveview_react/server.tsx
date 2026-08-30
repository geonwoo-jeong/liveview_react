import { renderToString } from "react-dom/server";

import { getRegistryEntry, loadComponent, normalizeRegistry } from "./registry";
import { createComponentTree } from "./tree";
import { createConnectionStore } from "./runtime/connection";
import {
  createUnavailableEventCallbacks,
  mergeEventCallbackProps,
} from "./runtime/event-callbacks";
import { normalizeRootOptions } from "./runtime/options";
import { SERVER_BRIDGE_CONTEXT } from "./runtime/server-context";
import {
  materializeInitialFrame,
  type InitialFrame,
} from "./transport/initialFrame";
import type { ComponentRegistry, LiveViewReactRootOptions } from "./types";

export interface CreateLiveViewReactServerOptions extends Pick<
  LiveViewReactRootOptions,
  "strictMode" | "wrapRoot"
> {
  readonly components: ComponentRegistry;
}

export type ServerRenderRequest = InitialFrame;

export interface LiveViewReactServer {
  readonly render: (request: ServerRenderRequest) => Promise<string>;
}

export function createLiveViewReactServer(
  options: CreateLiveViewReactServerOptions,
): LiveViewReactServer {
  const { components, rootOptions } = normalizeRootOptions(options, "server");
  const { strictMode = false, wrapRoot } = rootOptions;
  const registry = normalizeRegistry(components);

  return Object.freeze({
    async render(request: ServerRenderRequest): Promise<string> {
      const { children, component, componentProps, events, identifierPrefix } =
        materializeInitialFrame(request, "server render request");
      const entry = getRegistryEntry(registry, component);
      const Component = await loadComponent(component, entry);
      const connectionStore = createConnectionStore();

      try {
        const tree = createComponentTree({
          Component,
          props: mergeEventCallbackProps(
            componentProps,
            createUnavailableEventCallbacks(events),
            "server render request",
          ),
          children,
          componentName: component,
          connectionStore,
          context: SERVER_BRIDGE_CONTEXT,
          element: null,
          strictMode,
          ...(wrapRoot ? { wrapRoot } : {}),
        });

        return renderToString(tree, { identifierPrefix });
      } finally {
        connectionStore.destroy();
      }
    },
  });
}
