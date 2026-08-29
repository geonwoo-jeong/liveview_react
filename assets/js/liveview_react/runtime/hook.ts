import {
  getEagerComponent,
  getRegistryEntry,
  loadComponent,
} from "../registry";
import type {
  ComponentProps,
  ComponentRegistry,
  LiveViewReactRootOptions,
} from "../types";
import {
  findReactTarget,
  readChildren,
  readComponentName,
  readElementId,
  readInitialProps,
  readInitialStreams,
  readHydrationSnapshot,
  readNextProps,
  readNextStreams,
} from "./attrs";
import { createLiveViewBridge, type LiveViewHookHost } from "./bridge";
import { RootController, type RootRenderSnapshot } from "./root";

export interface LiveViewReactHookDefinition {
  mounted(this: LiveViewHookHost): void;
  updated(this: LiveViewHookHost): void;
  disconnected(this: LiveViewHookHost): void;
  reconnected(this: LiveViewHookHost): void;
  destroyed(this: LiveViewHookHost): void;
}

interface HookRuntimeOptions {
  readonly components: ComponentRegistry;
  readonly hook: LiveViewHookHost;
  readonly rootOptions: LiveViewReactRootOptions;
}

function reportAsyncFailure(message: string, error: unknown): void {
  const reason = error instanceof Error ? error : new Error(String(error));
  queueMicrotask(() => {
    throw new Error(message, { cause: reason });
  });
}

class HookRuntime {
  readonly #componentName: string;
  readonly #components: ComponentRegistry;
  readonly #element: HTMLElement;
  readonly #elementId: string;
  readonly #root: RootController;
  #destroyed = false;
  #loadGeneration = 0;
  #props: ComponentProps;
  #streams: ComponentProps;

  constructor({ components, hook, rootOptions }: HookRuntimeOptions) {
    this.#componentName = readComponentName(hook.el);
    this.#components = components;
    this.#element = hook.el;
    this.#elementId = readElementId(hook.el);
    this.#props = readInitialProps(hook.el);
    this.#streams = readInitialStreams(hook.el);
    const target = findReactTarget(hook.el);
    const hydrationSnapshot = readHydrationSnapshot(
      target,
      this.#componentName,
    );
    if (hydrationSnapshot) {
      target.removeAttribute("data-react-hydration");
    }
    this.#root = new RootController({
      ...rootOptions,
      componentName: this.#componentName,
      context: createLiveViewBridge(hook),
      element: hook.el,
      hydrate: hydrationSnapshot !== null,
      ...(hydrationSnapshot ? { hydrationSnapshot } : {}),
      initialSnapshot: this.#snapshot(),
      target,
    });
  }

  mount(): void {
    const entry = getRegistryEntry(this.#components, this.#componentName);
    const eagerComponent = getEagerComponent(entry);
    if (eagerComponent) {
      this.#root.mount(eagerComponent);
      return;
    }

    const generation = ++this.#loadGeneration;
    void loadComponent(this.#componentName, entry).then(
      (Component) => {
        if (!this.#isActive(generation)) return;

        try {
          this.#root.mount(Component);
        } catch (error: unknown) {
          reportAsyncFailure(
            `Unable to mount component "${this.#componentName}"`,
            error,
          );
        }
      },
      (error: unknown) => {
        if (!this.#isActive(generation)) return;
        reportAsyncFailure(
          `Unable to load component "${this.#componentName}"`,
          error,
        );
      },
    );
  }

  update(): void {
    if (this.#destroyed) return;
    this.#assertIdentity();
    this.#props = readNextProps(this.#element, this.#props);
    this.#streams = readNextStreams(this.#element, this.#streams);
    this.#root.update(this.#snapshot());
  }

  reconnect(): void {
    if (this.#destroyed) return;
    this.#assertIdentity();
    // LiveView applies the join snapshot and pending patches through updated()
    // before this callback. Re-reading either payload here would apply it twice.
    this.#root.setConnected();
  }

  disconnect(): void {
    if (this.#destroyed) return;
    this.#assertIdentity();
    this.#root.setDisconnected();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#loadGeneration += 1;
    this.#root.destroy();
  }

  #assertIdentity(): void {
    const currentName = this.#element.getAttribute("data-component");
    if (currentName !== this.#componentName) {
      this.#failIdentity(
        `data-component cannot change from "${this.#componentName}" to "${currentName ?? "<missing>"}" without replacing the LiveView root`,
      );
    }

    if (this.#element.id !== this.#elementId) {
      this.#failIdentity(
        `LiveView root id cannot change from "${this.#elementId}" to "${this.#element.id}" while mounted`,
      );
    }
  }

  #failIdentity(message: string): never {
    this.destroy();
    throw new Error(message);
  }

  #isActive(generation: number): boolean {
    return (
      !this.#destroyed &&
      !this.#root.destroyed &&
      generation === this.#loadGeneration
    );
  }

  #snapshot(): RootRenderSnapshot {
    return Object.freeze({
      children: readChildren(this.#element),
      props: Object.freeze({ ...this.#props, ...this.#streams }),
    });
  }
}

export function createLiveViewReactHook(
  components: ComponentRegistry,
  rootOptions: LiveViewReactRootOptions = {},
): LiveViewReactHookDefinition {
  const runtimes = new WeakMap<LiveViewHookHost, HookRuntime>();
  const immutableRootOptions = Object.freeze({ ...rootOptions });

  return Object.freeze({
    mounted(this: LiveViewHookHost) {
      if (runtimes.has(this)) {
        throw new Error("LiveViewReactHook is already mounted on this element");
      }

      const runtime = new HookRuntime({
        components,
        hook: this,
        rootOptions: immutableRootOptions,
      });
      runtimes.set(this, runtime);

      try {
        runtime.mount();
      } catch (error: unknown) {
        runtimes.delete(this);
        runtime.destroy();
        throw error;
      }
    },

    updated(this: LiveViewHookHost) {
      runtimes.get(this)?.update();
    },

    disconnected(this: LiveViewHookHost) {
      runtimes.get(this)?.disconnect();
    },

    reconnected(this: LiveViewHookHost) {
      runtimes.get(this)?.reconnect();
    },

    destroyed(this: LiveViewHookHost) {
      const runtime = runtimes.get(this);
      if (!runtime) return;

      runtimes.delete(this);
      runtime.destroy();
    },
  });
}
