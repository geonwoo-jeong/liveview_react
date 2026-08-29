import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { getRegistryEntry, loadComponent, normalizeRegistry } from "./registry";
import { createComponentTree } from "./tree";
import type {
  ComponentProps,
  ComponentRegistry,
  LiveViewReactContextValue,
  SlotMap,
} from "./types";

export interface CreateLiveViewReactServerOptions {
  readonly components: ComponentRegistry;
}

export interface ServerRenderRequest {
  readonly component: string;
  readonly props?: ComponentProps;
  readonly slots?: SlotMap;
}

export interface LiveViewReactServer {
  readonly render: (request: ServerRenderRequest) => Promise<string>;
}

function unavailableDuringServerRender(): never {
  throw new Error(
    "LiveView bridge methods are unavailable during server rendering",
  );
}

const serverContext: LiveViewReactContextValue = Object.freeze({
  el: null,
  liveSocket: null,
  pushEvent: unavailableDuringServerRender,
  pushEventTo: unavailableDuringServerRender,
  handleEvent: unavailableDuringServerRender,
  removeHandleEvent: unavailableDuringServerRender,
  upload: unavailableDuringServerRender,
  uploadTo: unavailableDuringServerRender,
});

function getChildren(slots: SlotMap): ReactNode[] {
  const defaultSlot = slots.default;
  if (!defaultSlot) return [];

  return [
    createElement("div", {
      dangerouslySetInnerHTML: { __html: defaultSlot.trim() },
    }),
  ];
}

export function createLiveViewReactServer({
  components,
}: CreateLiveViewReactServerOptions): LiveViewReactServer {
  const registry = normalizeRegistry(components);

  return Object.freeze({
    async render({
      component,
      props = {},
      slots = {},
    }: ServerRenderRequest): Promise<string> {
      const entry = getRegistryEntry(registry, component);
      const Component = await loadComponent(component, entry);
      const tree = createComponentTree({
        Component,
        props,
        children: getChildren(slots),
        context: serverContext,
      });

      return renderToString(tree);
    },
  });
}
