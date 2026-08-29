import type { ReactNode } from "react";
import {
  createRoot,
  hydrateRoot,
  type Root,
  type RootOptions,
} from "react-dom/client";

import { createComponentTree } from "../tree";
import type {
  ComponentProps,
  LiveViewReactComponent,
  LiveViewReactContextValue,
  LiveViewReactRootOptions,
} from "../types";
import { createConnectionStore, type ConnectionStore } from "./connection";
import { createIdentifierPrefix } from "./identifier-prefix";
import { SERVER_BRIDGE_CONTEXT } from "./server-context";

export interface RootRenderSnapshot {
  readonly children: readonly ReactNode[];
  readonly props: ComponentProps;
}

export interface RootControllerOptions extends LiveViewReactRootOptions {
  readonly componentName: string;
  readonly context: LiveViewReactContextValue;
  readonly element: HTMLElement;
  readonly hydrate: boolean;
  readonly hydrationSnapshot?: RootRenderSnapshot;
  readonly initialSnapshot: RootRenderSnapshot;
  readonly target: HTMLElement;
}

function copySnapshot(snapshot: RootRenderSnapshot): RootRenderSnapshot {
  return Object.freeze({
    children: Object.freeze([...snapshot.children]),
    props: Object.freeze({ ...snapshot.props }),
  });
}

function createRootOptions({
  element,
  onCaughtError,
  onRecoverableError,
  onUncaughtError,
}: LiveViewReactRootOptions &
  Pick<RootControllerOptions, "element">): RootOptions {
  return {
    identifierPrefix: createIdentifierPrefix(element.id),
    ...(onCaughtError ? { onCaughtError } : {}),
    ...(onRecoverableError ? { onRecoverableError } : {}),
    ...(onUncaughtError ? { onUncaughtError } : {}),
  };
}

export class RootController {
  readonly #componentName: string;
  readonly #connectionStore: ConnectionStore;
  readonly #context: LiveViewReactContextValue;
  readonly #element: HTMLElement;
  readonly #hydrate: boolean;
  readonly #reactOptions: RootOptions;
  readonly #strictMode: boolean;
  readonly #target: HTMLElement;
  readonly #wrapRoot: LiveViewReactRootOptions["wrapRoot"];
  #Component: LiveViewReactComponent | null = null;
  #destroyed = false;
  #hydrating = false;
  #hydratedVersion = 0;
  #root: Root | null = null;
  #snapshot: RootRenderSnapshot;
  #snapshotVersion = 0;
  readonly #hydrationSnapshot: RootRenderSnapshot;

  constructor(options: RootControllerOptions) {
    this.#componentName = options.componentName;
    this.#connectionStore = createConnectionStore();
    this.#context = options.context;
    this.#element = options.element;
    this.#hydrate = options.hydrate;
    this.#reactOptions = Object.freeze(createRootOptions(options));
    if (options.hydrate && !options.hydrationSnapshot) {
      throw new Error("Hydration requires the immutable server snapshot");
    }
    if (!options.hydrate && options.hydrationSnapshot) {
      throw new Error("A hydration snapshot requires hydration mode");
    }

    this.#snapshot = copySnapshot(options.initialSnapshot);
    this.#hydrationSnapshot = copySnapshot(
      options.hydrationSnapshot ?? options.initialSnapshot,
    );
    this.#snapshotVersion = options.hydrate ? 1 : 0;
    this.#strictMode = options.strictMode === true;
    this.#target = options.target;
    this.#wrapRoot = options.wrapRoot;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get mounted(): boolean {
    return this.#root !== null;
  }

  mount(Component: LiveViewReactComponent): boolean {
    if (this.#destroyed) return false;
    if (this.#root) {
      throw new Error(`Component "${this.#componentName}" is already mounted`);
    }

    this.#Component = Component;
    if (this.#hydrate) {
      this.#hydrating = true;
      const tree = this.#createTree(this.#hydrationSnapshot, () =>
        this.#completeHydration(),
      );
      this.#root = hydrateRoot(this.#target, tree, this.#reactOptions);
    } else {
      this.#root = createRoot(this.#target, this.#reactOptions);
      this.#root.render(this.#createTree(this.#snapshot));
    }

    return true;
  }

  update(snapshot: RootRenderSnapshot): boolean {
    if (this.#destroyed) return false;

    this.#snapshot = copySnapshot(snapshot);
    this.#snapshotVersion += 1;
    if (!this.#root) return false;
    if (this.#hydrating) return false;

    this.#root.render(this.#createTree(this.#snapshot));
    return true;
  }

  setConnected(): void {
    if (this.#destroyed) return;
    this.#connectionStore.setConnected();
  }

  setDisconnected(): void {
    if (this.#destroyed) return;
    this.#connectionStore.setDisconnected();
  }

  destroy(): boolean {
    if (this.#destroyed) return false;

    this.#destroyed = true;
    this.#connectionStore.destroy();
    this.#hydrating = false;
    const root = this.#root;
    this.#root = null;
    this.#Component = null;
    if (!root) return false;

    root.unmount();
    return true;
  }

  #completeHydration(): void {
    if (this.#destroyed || !this.#hydrating) return;

    this.#hydrating = false;
    if (!this.#root || this.#snapshotVersion === this.#hydratedVersion) return;

    this.#hydratedVersion = this.#snapshotVersion;
    this.#root.render(this.#createTree(this.#snapshot));
  }

  #createTree(
    snapshot: RootRenderSnapshot,
    onHydrated?: () => void,
  ): ReactNode {
    if (!this.#Component) {
      throw new Error(`Component "${this.#componentName}" is not resolved`);
    }

    const hydrating = onHydrated !== undefined;
    return createComponentTree({
      Component: this.#Component,
      children: snapshot.children,
      componentName: this.#componentName,
      connectionStore: this.#connectionStore,
      context: hydrating ? SERVER_BRIDGE_CONTEXT : this.#context,
      element: hydrating ? null : this.#element,
      ...(onHydrated ? { onHydrated } : {}),
      props: snapshot.props,
      strictMode: this.#strictMode,
      ...(this.#wrapRoot ? { wrapRoot: this.#wrapRoot } : {}),
    });
  }
}
