import { createElement, type ReactNode } from "react";
import {
  createRoot,
  hydrateRoot,
  type Root as ReactRoot,
} from "react-dom/client";

import { decodeCompactJson, decodeCompactPatch } from "./compactPatch";
import { applyPatch } from "./jsonPatch";
import { getEagerComponent, getRegistryEntry, loadComponent } from "./registry";
import { createComponentTree } from "./tree";
import type {
  ComponentProps,
  ComponentRegistry,
  HandleEvent,
  LiveViewReactComponent,
  LiveViewReactContextValue,
  PushEvent,
  PushEventTo,
  RemoveHandleEvent,
  SlotMap,
  Upload,
  UploadTo,
} from "./types";

interface LiveViewHookHost {
  readonly el: HTMLElement;
  readonly liveSocket?: unknown;
  readonly pushEvent: PushEvent;
  readonly pushEventTo: PushEventTo;
  readonly handleEvent: HandleEvent;
  readonly removeHandleEvent: RemoveHandleEvent;
  readonly upload: Upload;
  readonly uploadTo: UploadTo;
}

interface LiveViewReactHookState {
  _Component: LiveViewReactComponent | null;
  _bridge: LiveViewReactContextValue;
  _destroyed: boolean;
  _loadGeneration: number;
  _props: ComponentProps;
  _root: ReactRoot | null;
  _streams: ComponentProps;
  _target: HTMLElement | null;
}

type LiveViewReactHookInstance = LiveViewHookHost & LiveViewReactHookState;

export interface LiveViewReactHookDefinition {
  mounted(this: LiveViewHookHost): void;
  updated(this: LiveViewHookHost): void;
  reconnected(this: LiveViewHookHost): void;
  destroyed(this: LiveViewHookHost): void;
}

function isProps(value: unknown): value is ComponentProps {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonAttribute(
  element: HTMLElement,
  attributeName: string,
): unknown {
  const data = element.getAttribute(attributeName);
  return data ? JSON.parse(data) : {};
}

function readSlotMap(element: HTMLElement): SlotMap {
  const value = readJsonAttribute(element, "data-slots");
  if (!isProps(value)) {
    throw new TypeError("data-slots must contain a JSON object");
  }

  for (const [slotName, slot] of Object.entries(value)) {
    if (typeof slot !== "string") {
      throw new TypeError(`Slot "${slotName}" must contain encoded HTML`);
    }
  }

  return value as SlotMap;
}

function readBaseProps(element: HTMLElement): ComponentProps {
  const data = element.getAttribute("data-props");
  const value = data ? decodeCompactJson(data) : {};

  if (!isProps(value)) {
    throw new TypeError("data-props must contain an encoded object");
  }

  return value;
}

function getChildren(element: HTMLElement): ReactNode[] {
  const defaultSlot = readSlotMap(element).default;
  if (!defaultSlot) return [];

  return [
    createElement("div", {
      dangerouslySetInnerHTML: { __html: atob(defaultSlot).trim() },
    }),
  ];
}

function createBridge(hook: LiveViewHookHost): LiveViewReactContextValue {
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

function getTarget(hook: LiveViewReactHookInstance): HTMLElement {
  const target = hook._target ?? hook.el.querySelector("[data-react-target]");

  if (!(target instanceof HTMLElement)) {
    throw new Error(
      "LiveViewReactHook requires a [data-react-target] child element",
    );
  }

  hook._target = target;
  return target;
}

function refreshStreams(hook: LiveViewReactHookInstance): void {
  hook._streams = applyPatch(
    hook._streams,
    decodeCompactPatch(hook.el.getAttribute("data-streams-diff")),
  );
}

function refreshProps(hook: LiveViewReactHookInstance): void {
  if (hook.el.getAttribute("data-use-diff") === "true") {
    hook._props = applyPatch(
      hook._props,
      decodeCompactPatch(hook.el.getAttribute("data-props-diff")),
    );
    return;
  }

  hook._props = readBaseProps(hook.el);
}

function render(hook: LiveViewReactHookInstance): void {
  if (!hook._root || !hook._Component) return;

  const tree = createComponentTree({
    Component: hook._Component,
    props: { ...hook._props, ...hook._streams },
    children: getChildren(hook.el),
    context: hook._bridge,
  });

  hook._root.render(tree);
}

function mountRoot(
  hook: LiveViewReactHookInstance,
  Component: LiveViewReactComponent,
): void {
  if (hook._destroyed) return;

  hook._Component = Component;
  const target = getTarget(hook);
  const tree = createComponentTree({
    Component,
    props: { ...hook._props, ...hook._streams },
    children: getChildren(hook.el),
    context: hook._bridge,
  });

  if (hook.el.hasAttribute("data-ssr")) {
    hook._root = hydrateRoot(target, tree);
    return;
  }

  hook._root = createRoot(target);
  hook._root.render(tree);
}

function reportLoadFailure(componentName: string, error: unknown): void {
  const reason = error instanceof Error ? error : new Error(String(error));
  queueMicrotask(() => {
    throw new Error(`Unable to load component "${componentName}"`, {
      cause: reason,
    });
  });
}

export function createLiveViewReactHook(
  components: ComponentRegistry,
): LiveViewReactHookDefinition {
  return {
    mounted() {
      const hook = this as LiveViewReactHookInstance;
      const componentName = hook.el.getAttribute("data-component");
      if (!componentName) {
        throw new Error("data-component must name a registered component");
      }

      hook._Component = null;
      hook._bridge = createBridge(hook);
      hook._destroyed = false;
      hook._loadGeneration = 0;
      hook._props = readBaseProps(hook.el);
      hook._root = null;
      hook._streams = {};
      hook._target = null;
      refreshStreams(hook);

      const entry = getRegistryEntry(components, componentName);
      const eagerComponent = getEagerComponent(entry);
      if (eagerComponent) {
        mountRoot(hook, eagerComponent);
        return;
      }

      const generation = ++hook._loadGeneration;
      void loadComponent(componentName, entry)
        .then((Component) => {
          if (hook._destroyed || generation !== hook._loadGeneration) return;
          mountRoot(hook, Component);
        })
        .catch((error: unknown) => {
          if (hook._destroyed || generation !== hook._loadGeneration) return;
          reportLoadFailure(componentName, error);
        });
    },

    updated() {
      const hook = this as LiveViewReactHookInstance;
      refreshProps(hook);
      refreshStreams(hook);
      render(hook);
    },

    reconnected() {
      const hook = this as LiveViewReactHookInstance;
      hook._props = readBaseProps(hook.el);
      refreshStreams(hook);
      render(hook);
    },

    destroyed() {
      const hook = this as LiveViewReactHookInstance;
      hook._destroyed = true;
      hook._loadGeneration += 1;

      if (hook._root) {
        hook._root.unmount();
        hook._root = null;
      }
    },
  };
}
