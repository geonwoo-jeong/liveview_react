import {
  act,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveViewReact } from "../context";
import { useEventReply } from "../hooks/useEventReply";
import type { UseLiveFormResult } from "../hooks/useLiveForm";
import {
  FormProbe,
  serverForm,
  setInputValue,
  type SubmitReply,
  type Values,
} from "../hooks/useLiveForm.test-support";
import { useLiveEvent } from "../hooks/useLiveEvent";
import { useLiveForm } from "../hooks/useLiveForm";
import { useLiveNavigation } from "../hooks/useLiveNavigation";
import {
  useLiveUpload,
  type UseLiveUploadResult,
} from "../hooks/useLiveUpload";
import {
  installLiveInput,
  uploadConfig,
} from "../hooks/useLiveUpload.test-support";
import { LIVE_FORM_SUBMIT_EVENT } from "../hooks/live-form-runtime";
import { createLiveViewReactServer } from "../server";
import type {
  LiveViewReactContextValue,
  LiveViewReactRootOptions,
  PushEvent,
} from "../types";
import { applyPatch } from "../transport/jsonPatch";
import type { EventCommandExecutor } from "./event-callbacks";
import { createIdentifierPrefix } from "./identifier-prefix";
import { RootController, type RootRenderSnapshot } from "./root";

const EMPTY_SERVER_FRAME = Object.freeze({
  props: Object.freeze({}),
  slots: Object.freeze({}),
  streams: Object.freeze({}),
  version: 2 as const,
});

function createContext(
  element: HTMLElement,
  liveSocket: unknown = null,
): LiveViewReactContextValue {
  return {
    el: element,
    liveSocket,
    pushEvent: vi.fn(() =>
      Promise.resolve(undefined),
    ) as unknown as LiveViewReactContextValue["pushEvent"],
    pushEventTo: vi.fn(() => Promise.resolve([])),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };
}

function snapshot(
  props: Record<string, unknown>,
  events: RootRenderSnapshot["events"] = {},
): RootRenderSnapshot {
  return { children: [], events, props };
}

function createController(
  target: HTMLElement,
  initialSnapshot: RootRenderSnapshot,
  options: LiveViewReactRootOptions & {
    readonly hydrate?: boolean;
    readonly hydrationSnapshot?: RootRenderSnapshot;
    readonly executeEventCommands?: EventCommandExecutor;
    readonly liveSocket?: unknown;
    readonly context?: LiveViewReactContextValue;
  } = {},
) {
  const element = document.createElement("div");
  element.id = "react-root";
  element.append(target);
  const {
    executeEventCommands = vi.fn(),
    liveSocket = null,
    context = createContext(element, liveSocket),
    ...rootOptions
  } = options;

  return new RootController({
    ...rootOptions,
    componentName: "Stateful",
    context,
    element,
    executeEventCommands,
    hydrate: options.hydrate === true,
    initialSnapshot,
    target,
  });
}

describe("RootController", () => {
  beforeEach(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("updates the existing root without losing component-local state", async () => {
    function Stateful({ label }: { readonly label: string }) {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          {label}:{count}
        </button>
      );
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({ label: "first" }));

    await act(async () => controller.mount(Stateful));
    await act(async () => target.querySelector("button")?.click());
    await act(async () => controller.update(snapshot({ label: "second" })));

    expect(target.textContent).toBe("second:1");
    await act(async () => controller.destroy());
  });

  it("preserves unchanged prop references so React.memo skips child work", async () => {
    const childRender = vi.fn();
    const stable = { label: "stable" };
    const initialProps = { dynamic: { count: 1 }, stable };
    const nextProps = applyPatch(initialProps, [
      { op: "replace", path: "/dynamic/count", value: 2 },
    ]);

    const MemoChild = memo(function MemoChild({
      value,
    }: {
      value: typeof stable;
    }) {
      childRender();
      return <span>{value.label}</span>;
    });

    function Parent({
      dynamic,
      stable: stableValue,
    }: {
      readonly dynamic: { readonly count: number };
      readonly stable: typeof stable;
    }) {
      return (
        <div>
          <MemoChild value={stableValue} />
          <output>{dynamic.count}</output>
        </div>
      );
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot(initialProps));

    await act(async () => controller.mount(Parent));
    await act(async () => controller.update(snapshot(nextProps)));

    expect(target.querySelector("output")?.textContent).toBe("2");
    expect(childRender).toHaveBeenCalledTimes(1);
    await act(async () => controller.destroy());
  });

  it("keeps event callbacks stable and invalidates stale references", async () => {
    const exec = vi.fn();
    const render = vi.fn();
    let retained: ((payload?: Record<string, unknown>) => void) | undefined;
    const EventProbe = memo(function EventProbe({
      onIncrement,
    }: {
      readonly onIncrement: (payload?: Record<string, unknown>) => void;
    }) {
      render();
      retained = onIncrement;
      return <button onClick={() => onIncrement({ client: 2 })}>run</button>;
    });
    const initialEvents = {
      onIncrement: [["push", { event: "increment", value: { static: 1 } }]],
    } as const;
    const target = document.createElement("div");
    const controller = createController(target, snapshot({}, initialEvents), {
      executeEventCommands: exec,
    });

    await act(async () => controller.mount(EventProbe));
    const first = retained!;
    await act(async () => controller.update(snapshot({}, initialEvents)));

    expect(retained).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);

    await act(async () => target.querySelector("button")?.click());
    expect(exec).toHaveBeenCalledWith([
      ["push", { event: "increment", value: { static: 1, client: 2 } }],
    ]);

    const changedEvents = {
      onIncrement: [["push", { event: "increment-v2" }]],
    } as const;
    await act(async () => controller.update(snapshot({}, changedEvents)));
    const changed = retained!;
    expect(changed).not.toBe(first);
    expect(render).toHaveBeenCalledTimes(2);

    first();
    expect(exec).toHaveBeenCalledTimes(1);

    await act(async () => controller.destroy());
    changed();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("unmounts effects exactly once when destroy is repeated", async () => {
    const cleanup = vi.fn();
    function Effectful() {
      useEffect(() => cleanup, []);
      return null;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}));

    await act(async () => controller.mount(Effectful));
    await act(async () => {
      controller.destroy();
      controller.destroy();
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("balances StrictMode effect setup and cleanup", async () => {
    const setup = vi.fn();
    const cleanup = vi.fn();
    function Effectful() {
      useEffect(() => {
        setup();
        return cleanup;
      }, []);
      return null;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}), {
      strictMode: true,
    });

    await act(async () => controller.mount(Effectful));
    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(1);

    await act(async () => controller.destroy());
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("places the custom wrapper inside the bridge provider", async () => {
    function Wrapper({ children }: { readonly children: ReactNode }) {
      const { el } = useLiveViewReact();
      return <section data-owner={el?.id}>{children}</section>;
    }

    const target = document.createElement("div");
    const controller = createController(target, snapshot({}), {
      wrapRoot: ({ children, componentName, element }) => (
        <Wrapper>
          <div data-component={componentName} data-element={element?.id}>
            {children}
          </div>
        </Wrapper>
      ),
    });

    await act(async () => controller.mount(() => <p>content</p>));

    expect(target.querySelector("section")?.dataset.owner).toBe("react-root");
    expect(
      target.querySelector("[data-component]")?.getAttribute("data-component"),
    ).toBe("Stateful");
    expect(target.textContent).toBe("content");
    await act(async () => controller.destroy());
  });

  it("hydrates the initial snapshot before flushing a pre-mount update", async () => {
    function Greeting({ label }: { readonly label: string }) {
      return <p>{label}</p>;
    }

    const recoverableError = vi.fn();
    const target = document.createElement("div");
    target.innerHTML = "<p>server</p>";
    const controller = createController(target, snapshot({ label: "latest" }), {
      hydrate: true,
      hydrationSnapshot: snapshot({ label: "server" }),
      onRecoverableError: recoverableError,
    });

    await act(async () => controller.mount(Greeting));

    expect(recoverableError).not.toHaveBeenCalled();
    expect(target.textContent).toBe("latest");
    await act(async () => controller.destroy());
  });

  it("hydrates a dead stream snapshot before committing the connected stream frame", async () => {
    interface User {
      readonly __dom_id: string;
      readonly name: string;
    }
    function UserList({ users }: { readonly users: readonly User[] }) {
      return (
        <section>
          {users.map((user) => (
            <article key={user.__dom_id}>{user.name}</article>
          ))}
        </section>
      );
    }

    const deadUsers = Object.freeze([
      Object.freeze({ __dom_id: "users-1", name: "Dead Ada" }),
    ]);
    const connectedUsers = Object.freeze([
      Object.freeze({ __dom_id: "users-1", name: "Connected Ada" }),
    ]);
    const recoverableError = vi.fn();
    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { UserList: { component: UserList } },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "UserList",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
      streams: { users: deadUsers },
    });
    const serverArticle = target.querySelector("article");
    const controller = createController(
      target,
      snapshot({ users: connectedUsers }),
      {
        hydrate: true,
        hydrationSnapshot: snapshot({ users: deadUsers }),
        onRecoverableError: recoverableError,
      },
    );

    await act(async () => controller.mount(UserList));

    expect(recoverableError).not.toHaveBeenCalled();
    expect(target.querySelector("article")).toBe(serverArticle);
    expect(target.textContent).toBe("Connected Ada");
    await act(async () => controller.destroy());
  });

  it("hydrates server useId markup without warnings or replacing its DOM node", async () => {
    function IdentifierProbe() {
      const id = useId();
      return (
        <label htmlFor={id}>
          Label
          <input id={id} defaultValue="server" />
        </label>
      );
    }

    const recoverableError = vi.fn();
    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { IdentifierProbe: { component: IdentifierProbe } },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "IdentifierProbe",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    const serverInput = target.querySelector("input");
    const controller = createController(target, snapshot({}), {
      hydrate: true,
      hydrationSnapshot: snapshot({}),
      onRecoverableError: recoverableError,
    });

    await act(async () => controller.mount(IdentifierProbe));

    const hydratedInput = target.querySelector("input");
    expect(recoverableError).not.toHaveBeenCalled();
    expect(hydratedInput).toBe(serverInput);
    expect(hydratedInput?.id).toContain("liveview-react-react-root-");
    expect(target.querySelector("label")?.htmlFor).toBe(hydratedInput?.id);
    await act(async () => controller.destroy());
  });

  it("activates useLiveEvent only after hydration and cleans up its live subscription", async () => {
    const activeCallbacks = new Set<(payload: string) => void>();
    const deliveries: string[] = [];
    const subscriptionReference = Object.freeze({ event: "ping" });
    const handleEvent = vi.fn(
      (event: string, callback: (payload: string) => void) => {
        expect(event).toBe("ping");
        activeCallbacks.add(callback);
        return subscriptionReference;
      },
    );
    const removeHandleEvent = vi.fn((reference: unknown) => {
      expect(reference).toBe(subscriptionReference);
      activeCallbacks.clear();
    });
    const context = Object.freeze({
      ...createContext(document.createElement("div")),
      handleEvent:
        handleEvent as unknown as LiveViewReactContextValue["handleEvent"],
      removeHandleEvent,
    });

    function EventSubscriptionProbe() {
      useLiveEvent<string>("ping", (payload) => deliveries.push(payload));
      return <p>subscribed</p>;
    }

    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: {
        EventSubscriptionProbe: { component: EventSubscriptionProbe },
      },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "EventSubscriptionProbe",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    const serverNode = target.firstElementChild;
    const controller = createController(target, snapshot({}), {
      context,
      hydrate: true,
      hydrationSnapshot: snapshot({}),
    });

    await act(async () => controller.mount(EventSubscriptionProbe));

    expect(target.firstElementChild).toBe(serverNode);
    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(removeHandleEvent).not.toHaveBeenCalled();
    expect(activeCallbacks.size).toBe(1);
    for (const callback of activeCallbacks) callback("hydrated");
    expect(deliveries).toEqual(["hydrated"]);

    await act(async () => controller.destroy());

    expect(removeHandleEvent).toHaveBeenCalledTimes(1);
    expect(activeCallbacks.size).toBe(0);
  });

  it("hydrates useLiveForm without touching the unavailable server bridge", async () => {
    const subscriptionReference = Object.freeze({
      event: LIVE_FORM_SUBMIT_EVENT,
    });
    const handleEvent = vi.fn(() => subscriptionReference);
    const removeHandleEvent = vi.fn();
    const context = Object.freeze({
      ...createContext(document.createElement("div")),
      handleEvent:
        handleEvent as unknown as LiveViewReactContextValue["handleEvent"],
      removeHandleEvent,
    });
    const formSnapshot = serverForm();
    const serverCaptured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    const clientCaptured: {
      current?: UseLiveFormResult<Values, SubmitReply>;
    } = {};
    const serverProps = {
      captured: serverCaptured,
      debounce: 0,
      snapshot: formSnapshot,
    };
    const clientProps = {
      captured: clientCaptured,
      debounce: 0,
      snapshot: formSnapshot,
    };
    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { FormProbe: { component: FormProbe } },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "FormProbe",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
      props: serverProps,
    });
    const serverFormElement = target.querySelector("form");
    const controller = createController(target, snapshot(clientProps), {
      context,
      hydrate: true,
      hydrationSnapshot: snapshot(clientProps),
    });

    await act(async () => controller.mount(FormProbe));

    expect(target.querySelector("form")).toBe(serverFormElement);
    expect(clientCaptured.current?.values).toEqual(formSnapshot.values);
    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledWith(
      LIVE_FORM_SUBMIT_EVENT,
      expect.any(Function),
    );
    expect(removeHandleEvent).not.toHaveBeenCalled();

    await act(async () => controller.destroy());

    expect(removeHandleEvent).toHaveBeenCalledOnce();
    expect(removeHandleEvent).toHaveBeenCalledWith(subscriptionReference);
  });

  it("switches event callbacks from hydration failures to the live executor", async () => {
    const callbacks: Array<() => void> = [];
    const exec = vi.fn();
    const events = {
      onIncrement: [["push", { event: "increment" }]],
    } as const;
    function EventProbe({ onIncrement }: { readonly onIncrement: () => void }) {
      callbacks.push(onIncrement);
      return <button>increment</button>;
    }

    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { EventProbe: { component: EventProbe } },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "EventProbe",
      events,
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    callbacks.length = 0;
    const controller = createController(target, snapshot({}, events), {
      hydrate: true,
      hydrationSnapshot: snapshot({}, events),
      executeEventCommands: exec,
    });

    await act(async () => controller.mount(EventProbe));

    expect(() => callbacks[0]?.()).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => callbacks.at(-1)?.()).not.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
    await act(async () => controller.destroy());
  });

  it("uses server-visible context during hydration before publishing the live bridge", async () => {
    function ContextProbe() {
      const context = useLiveViewReact();
      contexts.push(context);
      return <p>{context.el?.id ?? "server"}</p>;
    }

    const contexts: LiveViewReactContextValue[] = [];
    const recoverableError = vi.fn();
    const wrapRoot = vi.fn(({ children }) => children);
    const target = document.createElement("div");
    target.innerHTML = "<p>server</p>";
    const controller = createController(target, snapshot({}), {
      hydrate: true,
      hydrationSnapshot: snapshot({}),
      onRecoverableError: recoverableError,
      wrapRoot,
    });

    await act(async () => controller.mount(ContextProbe));

    expect(recoverableError).not.toHaveBeenCalled();
    expect(wrapRoot.mock.calls[0]?.[0].element).toBeNull();
    expect(wrapRoot.mock.calls.at(-1)?.[0].element?.id).toBe("react-root");
    expect(contexts[0]?.el).toBeNull();
    expect(contexts[0]?.liveSocket).toBeNull();
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(() => contexts[0]?.pushEvent("event")).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.pushEventTo("#target", "event")).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.handleEvent("event", () => undefined)).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.removeHandleEvent(null)).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.upload("upload", [])).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(() => contexts[0]?.uploadTo("#target", "upload", [])).toThrow(
      "unavailable during server rendering or hydration",
    );
    expect(contexts.at(-1)?.el?.id).toBe("react-root");
    expect(() => contexts.at(-1)?.pushEvent("event")).not.toThrow();
    expect(target.textContent).toBe("react-root");
    await act(async () => controller.destroy());
  });

  it("uses the live command bridge for useEventReply during hydration layout effects", async () => {
    const replies: Array<{ readonly ok: boolean }> = [];
    const pushEvent = vi.fn(() => Promise.resolve({ ok: true })) as PushEvent;
    const context = Object.freeze({
      ...createContext(document.createElement("div")),
      pushEvent,
    });

    function ReplyProbe() {
      const reply = useEventReply<{ readonly ok: boolean }>("ping");
      const executed = useRef(false);

      useLayoutEffect(() => {
        if (executed.current) return;
        executed.current = true;
        void reply.execute({ source: "layout" }).then((result) => {
          replies.push(result);
        });
      }, [reply]);

      return <p>{reply.isLoading ? "loading" : "idle"}</p>;
    }

    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { ReplyProbe: { component: ReplyProbe } },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "ReplyProbe",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    const controller = createController(target, snapshot({}), {
      context,
      hydrate: true,
      hydrationSnapshot: snapshot({}),
    });

    await act(async () => controller.mount(ReplyProbe));

    expect(pushEvent).toHaveBeenCalledOnce();
    expect(pushEvent).toHaveBeenCalledWith("ping", { source: "layout" });
    expect(replies).toEqual([{ ok: true }]);
    await act(async () => controller.destroy());
  });

  it("uses the live command bridge for useLiveNavigation during hydration layout effects", async () => {
    const navigate = vi.fn();
    const liveSocket = {
      js: () => ({
        exec: vi.fn(),
        navigate,
        patch: vi.fn(),
      }),
    };

    function NavigationProbe() {
      const navigation = useLiveNavigation();
      const navigated = useRef(false);

      useLayoutEffect(() => {
        if (navigated.current) return;
        navigated.current = true;
        navigation.navigate("/hydrated");
      }, [navigation]);

      return <p>navigation</p>;
    }

    const target = document.createElement("div");
    const server = createLiveViewReactServer({
      components: { NavigationProbe: { component: NavigationProbe } },
    });
    target.innerHTML = await server.render({
      ...EMPTY_SERVER_FRAME,
      component: "NavigationProbe",
      events: {},
      identifierPrefix: createIdentifierPrefix("react-root"),
    });
    const controller = createController(target, snapshot({}), {
      context: createContext(document.createElement("div"), liveSocket),
      hydrate: true,
      hydrationSnapshot: snapshot({}),
      liveSocket,
    });

    await act(async () => controller.mount(NavigationProbe));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/hydrated", undefined);
    await act(async () => controller.destroy());
  });

  it("uses the live command bridge for useLiveForm input during hydration layout effects", async () => {
    vi.useFakeTimers();
    const pushEvent = vi.fn(() => Promise.resolve(null)) as PushEvent;
    const context = Object.freeze({
      ...createContext(document.createElement("div")),
      pushEvent,
    });

    function HydrationFormProbe() {
      const form = useLiveForm<Values, SubmitReply>(serverForm(), {
        changeEvent: "validate",
        debounce: 0,
        submitEvent: "save",
      });
      const inputRef = useRef<HTMLInputElement | null>(null);
      const changed = useRef(false);

      useLayoutEffect(() => {
        if (changed.current) return;
        changed.current = true;
        if (inputRef.current) {
          setInputValue(inputRef.current, "hydrated@example.com");
        }
      }, []);

      return (
        <form {...form.formProps}>
          <input {...form.revisionInputProps} />
          <input ref={inputRef} {...form.field(["email"]).inputProps} />
        </form>
      );
    }

    try {
      const target = document.createElement("div");
      const server = createLiveViewReactServer({
        components: { HydrationFormProbe: { component: HydrationFormProbe } },
      });
      target.innerHTML = await server.render({
        ...EMPTY_SERVER_FRAME,
        component: "HydrationFormProbe",
        events: {},
        identifierPrefix: createIdentifierPrefix("react-root"),
      });
      const controller = createController(target, snapshot({}), {
        context,
        hydrate: true,
        hydrationSnapshot: snapshot({}),
      });

      await act(async () => controller.mount(HydrationFormProbe));
      await act(async () => vi.runAllTimers());

      expect(pushEvent).toHaveBeenCalledOnce();
      expect(pushEvent).toHaveBeenCalledWith("validate", {
        _liveview_react_revision: 1,
        _target: ["profile", "email"],
        profile: {
          ...serverForm().values,
          email: "hydrated@example.com",
        },
      });
      await act(async () => controller.destroy());
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the live upload bridge in the first hydration layout effect and cleans up", async () => {
    const config = uploadConfig();
    const { form, input } = installLiveInput(config, "hydration-upload-form");
    const addEventListener = vi.spyOn(input, "addEventListener");
    const removeEventListener = vi.spyOn(input, "removeEventListener");
    const pushEvent = vi.fn(() =>
      Promise.resolve({ cancelled: true }),
    ) as PushEvent;
    const uploadTo = vi.fn();
    const context = Object.freeze({
      ...createContext(document.createElement("div")),
      pushEvent,
      uploadTo,
    });
    const file = new File(["hydrated"], "hydrated.png", {
      type: "image/png",
    });
    const cancellationReplies: unknown[] = [];
    let captured: UseLiveUploadResult | undefined;
    let cleanupController: RootController | undefined;

    function HydrationUploadProbe() {
      const upload = useLiveUpload(config, {
        cancelEvent: "cancel_upload",
        changeEvent: "validate",
        formId: "hydration-upload-form",
        submitEvent: "save",
      });
      const cancelled = useRef(false);
      const uploaded = useRef(false);
      captured = upload;

      useLayoutEffect(() => {
        if (cancelled.current) return;
        cancelled.current = true;
        void upload
          .cancel("entry-1", { source: "hydration" })
          .then((reply) => cancellationReplies.push(reply));
      }, [upload]);

      useEffect(() => {
        if (uploaded.current || !upload.connected) return;
        uploaded.current = true;
        upload.addFiles([file]);
      }, [upload]);

      return <output>{upload.selections.length}</output>;
    }

    try {
      const target = document.createElement("div");
      const server = createLiveViewReactServer({
        components: {
          HydrationUploadProbe: { component: HydrationUploadProbe },
        },
      });
      target.innerHTML = await server.render({
        ...EMPTY_SERVER_FRAME,
        component: "HydrationUploadProbe",
        events: {},
        identifierPrefix: createIdentifierPrefix("react-root"),
      });
      const serverOutput = target.querySelector("output");
      const controller = createController(target, snapshot({}), {
        context,
        hydrate: true,
        hydrationSnapshot: snapshot({}),
      });
      cleanupController = controller;

      await act(async () => controller.mount(HydrationUploadProbe));

      expect(target.querySelector("output")).toBe(serverOutput);
      expect(pushEvent).toHaveBeenCalledOnce();
      expect(pushEvent).toHaveBeenCalledWith("cancel_upload", {
        name: "avatar",
        ref: "entry-1",
        source: "hydration",
      });
      expect(cancellationReplies).toEqual([{ cancelled: true }]);
      expect(uploadTo).toHaveBeenCalledOnce();
      expect(uploadTo).toHaveBeenCalledWith(form, "avatar", [file]);
      expect(
        addEventListener.mock.calls.filter(([name]) => name === "input"),
      ).toHaveLength(1);
      expect(
        removeEventListener.mock.calls.filter(([name]) => name === "input"),
      ).toHaveLength(0);
      expect(captured?.selections).toHaveLength(1);

      await act(async () => controller.destroy());

      expect(
        removeEventListener.mock.calls.filter(([name]) => name === "input"),
      ).toHaveLength(1);
      expect(() => captured?.addFiles([file])).toThrow(
        "useLiveUpload is not mounted in a browser document",
      );
    } finally {
      if (cleanupController !== undefined && !cleanupController.destroyed) {
        await act(async () => cleanupController?.destroy());
      }
      form.remove();
    }
  });
});
