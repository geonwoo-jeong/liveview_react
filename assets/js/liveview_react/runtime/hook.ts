import {
  getEagerComponent,
  getRegistryEntry,
  loadComponent,
} from "../registry";
import {
  assertTransportVersion,
  isFullSnapshotFrame,
  UnsupportedTransportVersionError,
} from "../transport/protocol";
import { materializeComponentInputs } from "../transport/initialFrame";
import type {
  ComponentProps,
  ComponentRegistry,
  LiveViewReactRootOptions,
  StreamMap,
} from "../types";
import {
  findReactTarget,
  readDecodedSlots,
  readComponentName,
  readElementId,
  readEvents,
  readInitialProps,
  readInitialStreams,
  readHydrationSnapshot,
  readNextProps,
  readNextStreams,
} from "./attrs";
import {
  createHookEventExecutor,
  createLiveViewBridge,
  type LiveViewHookHost,
} from "./bridge";
import type { EventCommandMap } from "./event-callbacks";
import {
  acquireNavigationDestroyLease,
  captureNavigationVisualSnapshot,
  type NavigationDestroyLease,
  type NavigationVisualSnapshot,
} from "./navigation-destroy";
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

interface HookRuntimeDestroyOptions {
  readonly navigation?: boolean;
}

interface FullSyncSocket {
  readonly connect: () => void;
  readonly disconnect: (callback?: () => void) => void;
}

function asFullSyncSocket(value: unknown): FullSyncSocket | null {
  if (typeof value !== "object" || value === null) return null;

  const socket = value as Partial<FullSyncSocket>;
  return typeof socket.connect === "function" &&
    typeof socket.disconnect === "function"
    ? (socket as FullSyncSocket)
    : null;
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
  readonly #liveSocket: unknown;
  readonly #navigation: NavigationDestroyLease;
  readonly #root: RootController;
  readonly #target: HTMLElement;
  #destroyed = false;
  #events: EventCommandMap;
  #loadGeneration = 0;
  #props: ComponentProps;
  #recovering = false;
  #streams: StreamMap;

  constructor({ components, hook, rootOptions }: HookRuntimeOptions) {
    this.#componentName = readComponentName(hook.el);
    this.#components = components;
    this.#element = hook.el;
    this.#elementId = readElementId(hook.el);
    this.#liveSocket = hook.liveSocket;
    const target = findReactTarget(hook.el);
    this.#target = target;
    const hydrationFrame = readHydrationSnapshot(
      target,
      this.#componentName,
      this.#elementId,
    );
    this.#props = readInitialProps(hook.el);
    this.#events = readEvents(hook.el);
    this.#streams = readInitialStreams(
      hook.el,
      hydrationFrame?.streams ?? null,
    );
    if (hydrationFrame) {
      target.removeAttribute("data-react-hydration");
    }
    this.#root = new RootController({
      ...rootOptions,
      componentName: this.#componentName,
      context: createLiveViewBridge(hook),
      element: hook.el,
      executeEventCommands: createHookEventExecutor(hook),
      hydrate: hydrationFrame !== null,
      ...(hydrationFrame ? { hydrationSnapshot: hydrationFrame.snapshot } : {}),
      initialSnapshot: this.#snapshot(),
      target,
    });
    this.#navigation = acquireNavigationDestroyLease(this.#element);
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
          this.#failAsyncMount(
            `Unable to mount component "${this.#componentName}"`,
            error,
          );
        }
      },
      (error: unknown) => {
        if (!this.#isActive(generation)) return;
        this.#failAsyncMount(
          `Unable to load component "${this.#componentName}"`,
          error,
        );
      },
    );
  }

  update(): void {
    if (this.#destroyed) return;
    this.#assertIdentity();

    try {
      assertTransportVersion(this.#element);
    } catch (error: unknown) {
      this.#failUpdate(error);
    }

    if (this.#recovering && !isFullSnapshotFrame(this.#element)) return;

    let nextProps: ComponentProps;
    let nextStreams: StreamMap;
    let nextEvents: EventCommandMap;

    try {
      nextProps = readNextProps(this.#element, this.#props);
      nextStreams = readNextStreams(this.#element, this.#streams);
      nextEvents = readEvents(this.#element);
    } catch (error: unknown) {
      if (
        error instanceof UnsupportedTransportVersionError ||
        this.#recovering ||
        !this.#requestFullSync()
      ) {
        this.#failUpdate(error);
      }
      return;
    }

    try {
      this.#root.update(this.#snapshot(nextProps, nextStreams, nextEvents));
    } catch (error: unknown) {
      this.#failUpdate(error);
    }

    this.#props = nextProps;
    this.#streams = nextStreams;
    this.#events = nextEvents;
    this.#recovering = false;
  }

  reconnect(): void {
    if (this.#destroyed) return;
    this.#assertIdentity();
    // LiveView applies the join snapshot and pending patches through updated()
    // before this callback. Re-reading either payload here would apply it twice.
    if (!this.#recovering) this.#root.setConnected();
  }

  disconnect(): void {
    if (this.#destroyed) return;
    this.#assertIdentity();
    this.#root.setDisconnected();
  }

  destroy(options: HookRuntimeDestroyOptions = {}): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#recovering = false;
    this.#loadGeneration += 1;

    const reservation = options.navigation
      ? this.#navigation.reserve(this.#element)
      : null;
    let snapshot: NavigationVisualSnapshot | null = null;
    if (reservation && this.#root.mounted) {
      try {
        snapshot = captureNavigationVisualSnapshot(this.#target);
      } catch {
        reservation.cancel();
      }
    }

    let destroyError: unknown;
    let destroyFailed = false;
    try {
      this.#root.destroy();
    } catch (error: unknown) {
      destroyFailed = true;
      destroyError = error;
    }

    try {
      if (snapshot?.restore()) {
        if (!reservation?.commit(snapshot.remove)) snapshot.remove();
      } else {
        reservation?.cancel();
      }
    } finally {
      this.#navigation.release();
    }

    if (destroyFailed) throw destroyError;
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

  #failUpdate(error: unknown): never {
    this.destroy();
    throw error;
  }

  #requestFullSync(): boolean {
    const socket = asFullSyncSocket(this.#liveSocket);
    if (!socket) return false;

    this.#recovering = true;
    queueMicrotask(() => {
      if (this.#destroyed || !this.#recovering) return;

      try {
        socket.disconnect(() => {
          if (this.#destroyed || !this.#recovering) return;

          try {
            socket.connect();
          } catch (error: unknown) {
            this.#failAsyncRecovery(error);
          }
        });
      } catch (error: unknown) {
        this.#failAsyncRecovery(error);
      }
    });

    return true;
  }

  #failAsyncRecovery(error: unknown): void {
    this.destroy();
    reportAsyncFailure(
      `Unable to recover component "${this.#componentName}" with a full LiveView sync`,
      error,
    );
  }

  #failAsyncMount(message: string, error: unknown): void {
    try {
      this.destroy();
    } catch (destroyError: unknown) {
      reportAsyncFailure(
        message,
        new AggregateError(
          [error, destroyError],
          "Component failure was followed by a teardown failure",
        ),
      );
      return;
    }

    reportAsyncFailure(message, error);
  }

  #isActive(generation: number): boolean {
    return (
      !this.#destroyed &&
      !this.#root.destroyed &&
      generation === this.#loadGeneration
    );
  }

  #snapshot(
    props: ComponentProps = this.#props,
    streams: StreamMap = this.#streams,
    events: EventCommandMap = this.#events,
  ): RootRenderSnapshot {
    const materialized = materializeComponentInputs(
      {
        events,
        props,
        slots: readDecodedSlots(this.#element),
        streams,
      },
      "LiveView transport frame",
    );

    return Object.freeze({
      children: materialized.children,
      events: materialized.events,
      props: materialized.props,
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
      runtime.destroy({ navigation: true });
    },
  });
}
