import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { getRegistryEntry, loadComponent, normalizeRegistry } from "./registry";
import { createComponentTree } from "./tree";
import { createConnectionStore } from "./runtime/connection";
import {
  assertNoEventPropCollisions,
  createUnavailableEventCallbacks,
  mergeEventCallbackProps,
  normalizeEventCommandMap,
  type EventCommandMap,
} from "./runtime/event-callbacks";
import { normalizeRootOptions } from "./runtime/options";
import { SERVER_BRIDGE_CONTEXT } from "./runtime/server-context";
import { createSlotBindings } from "./runtime/slots";
import type {
  ComponentProps,
  ComponentRegistry,
  LiveViewReactRootOptions,
  SlotMap,
} from "./types";

export interface CreateLiveViewReactServerOptions extends Pick<
  LiveViewReactRootOptions,
  "strictMode" | "wrapRoot"
> {
  readonly components: ComponentRegistry;
}

export interface ServerRenderRequest {
  readonly component: string;
  readonly events: EventCommandMap;
  readonly identifierPrefix: string;
  readonly props?: ComponentProps;
  readonly slots?: SlotMap;
}

export interface LiveViewReactServer {
  readonly render: (request: ServerRenderRequest) => Promise<string>;
}

interface NormalizedServerRenderRequest {
  readonly component: string;
  readonly events: EventCommandMap;
  readonly identifierPrefix: string;
  readonly props: ComponentProps;
  readonly slots: SlotMap;
}

const SERVER_RENDER_FIELDS: readonly string[] = Object.freeze([
  "component",
  "events",
  "identifierPrefix",
  "props",
  "slots",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertEnumerableDataProperties(
  value: Record<string, unknown>,
  source: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${source} keys must be strings`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${source} must use enumerable data properties`);
    }
  }
}

function normalizeRenderRequest(input: unknown): NormalizedServerRenderRequest {
  if (!isRecord(input)) {
    throw new TypeError("server render request must be a plain object");
  }
  assertEnumerableDataProperties(input, "server render request");

  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !SERVER_RENDER_FIELDS.includes(key)) {
      throw new TypeError(
        `Unknown server render request field "${String(key)}"`,
      );
    }
  }

  if (typeof input.component !== "string" || input.component.length === 0) {
    throw new TypeError("server render component must be a non-empty string");
  }
  if (
    typeof input.identifierPrefix !== "string" ||
    input.identifierPrefix.length === 0
  ) {
    throw new TypeError(
      "server render identifierPrefix must be a non-empty string",
    );
  }

  const props = Object.hasOwn(input, "props") ? input.props : {};
  if (!isRecord(props)) {
    throw new TypeError("server render props must be a plain object");
  }
  assertEnumerableDataProperties(props, "server render props");

  const slots = Object.hasOwn(input, "slots") ? input.slots : {};
  if (!isRecord(slots)) {
    throw new TypeError("server render slots must be a plain object");
  }
  assertEnumerableDataProperties(slots, "server render slots");
  for (const [slotName, slot] of Object.entries(slots)) {
    if (typeof slot !== "string") {
      throw new TypeError(`Server render slot "${slotName}" must be a string`);
    }
  }

  const events = normalizeEventCommandMap(input.events, "server render events");
  assertNoEventPropCollisions(props, events, "server render request");

  return Object.freeze({
    component: input.component,
    events,
    identifierPrefix: input.identifierPrefix,
    props: Object.freeze({ ...props }),
    slots: Object.freeze({ ...slots }) as SlotMap,
  });
}

export function createLiveViewReactServer(
  options: CreateLiveViewReactServerOptions,
): LiveViewReactServer {
  const { components, rootOptions } = normalizeRootOptions(options, "server");
  const { strictMode = false, wrapRoot } = rootOptions;
  const registry = normalizeRegistry(components);

  return Object.freeze({
    async render(request: ServerRenderRequest): Promise<string> {
      const { component, events, identifierPrefix, props, slots } =
        normalizeRenderRequest(request);
      const slotBindings = createSlotBindings(
        slots,
        props,
        "server render request",
      );
      const entry = getRegistryEntry(registry, component);
      const Component = await loadComponent(component, entry);
      const connectionStore = createConnectionStore();

      try {
        const tree = createComponentTree({
          Component,
          props: mergeEventCallbackProps(
            Object.freeze({
              ...props,
              ...slotBindings.props,
            }),
            createUnavailableEventCallbacks(events),
            "server render request",
          ),
          children: slotBindings.children,
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
