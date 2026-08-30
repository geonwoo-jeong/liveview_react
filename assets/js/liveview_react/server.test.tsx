import { createElement, type ReactNode } from "react";
import { preload, preloadModule } from "react-dom";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { useLiveViewReact } from "./context";
import {
  createLiveViewReactServer,
  type CreateLiveViewReactServerOptions,
} from "./server";

interface GreetingProps {
  readonly name?: string;
}

const IDENTIFIER_PREFIX = "liveview-react-server-test-";
const EMPTY_INITIAL_FRAME_FIELDS = Object.freeze({
  props: Object.freeze({}),
  slots: Object.freeze({}),
  streams: Object.freeze({}),
  version: 2 as const,
});

function Greeting({ name = "world" }: GreetingProps) {
  return createElement("p", null, `Hello ${name}`);
}

describe("createLiveViewReactServer", () => {
  it("renders mandatory stream props from a transport-v2 initial frame", async () => {
    function UserList({
      users,
    }: {
      readonly users: readonly Readonly<{
        readonly __dom_id: string;
        readonly name: string;
      }>[];
    }) {
      return createElement(
        "section",
        null,
        users.map((user) =>
          createElement("article", { key: user.__dom_id }, user.name),
        ),
      );
    }
    const server = createLiveViewReactServer({
      components: { UserList: { component: UserList } },
    });

    await expect(
      server.render({
        component: "UserList",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        props: {},
        slots: {},
        streams: {
          users: [{ __dom_id: "users-1", name: "Ada" }],
        },
        version: 2,
      }),
    ).resolves.toBe("<section><article>Ada</article></section>");
  });

  it("renders a tagged eager component", async () => {
    const server = createLiveViewReactServer({
      components: { Greeting: { component: Greeting } },
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        props: { name: "LiveView" },
      }),
    ).resolves.toBe("<p>Hello LiveView</p>");
  });

  it("renders a tagged lazy component", async () => {
    const server = createLiveViewReactServer({
      components: {
        Greeting: { load: async () => ({ default: Greeting }) },
      },
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        props: { name: "React" },
      }),
    ).resolves.toBe("<p>Hello React</p>");
  });

  it("includes default slot HTML", async () => {
    const Card = ({ children }: { readonly children?: ReactNode }) =>
      createElement("section", null, children);
    const server = createLiveViewReactServer({
      components: { Card: { component: Card } },
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Card",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        slots: { default: "<strong>Server slot</strong>" },
      }),
    ).resolves.toBe(
      '<section><div data-liveview-react-slot="default"><strong>Server slot</strong></div></section>',
    );
  });

  it("maps named slots to dedicated React props", async () => {
    function Dialog({
      children,
      footer,
      header,
    }: {
      readonly children?: ReactNode;
      readonly footer?: ReactNode;
      readonly header?: ReactNode;
    }) {
      return createElement(
        "section",
        null,
        createElement("header", null, header),
        createElement("main", null, children),
        createElement("footer", null, footer),
      );
    }

    const server = createLiveViewReactServer({
      components: { Dialog: { component: Dialog } },
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Dialog",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        slots: {
          default: "<p>Body</p>",
          footer: "<em>Footer</em>",
          header: "<strong>Header</strong>",
        },
      }),
    ).resolves.toBe(
      '<section><header><div data-liveview-react-slot="header"><strong>Header</strong></div></header><main><div data-liveview-react-slot="default"><p>Body</p></div></main><footer><div data-liveview-react-slot="footer"><em>Footer</em></div></footer></section>',
    );
  });

  it("rejects an unknown component", async () => {
    const server = createLiveViewReactServer({ components: {} });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Missing",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
      }),
    ).rejects.toThrow('Component "Missing" is not registered');
  });

  it.each([
    [null, "server render request must be a plain object"],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
      },
      "component must be a non-empty string",
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        props: [],
      },
      "props must be a plain object",
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        slots: { default: 1 },
      },
      'slot "default" must be a string',
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        unexpected: true,
      },
      'Unknown server render request field "unexpected"',
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: "",
      },
      "identifierPrefix must be a non-empty string",
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        identifierPrefix: IDENTIFIER_PREFIX,
      },
      'requires field "events"',
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        version: 1,
      },
      "version must be 2",
    ],
    [
      {
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: { increment: [] },
        identifierPrefix: IDENTIFIER_PREFIX,
      },
      "must be a React onCamelCase prop name",
    ],
  ])(
    "validates server render requests at runtime",
    async (request, message) => {
      const server = createLiveViewReactServer({
        components: { Greeting: { component: Greeting } },
      });

      await expect(server.render(request as never)).rejects.toThrow(message);
    },
  );

  it("rejects accessor render requests without invoking accessors", async () => {
    const getter = vi.fn(() => "Greeting");
    const request = Object.defineProperty({}, "component", {
      enumerable: true,
      get: getter,
    });
    const server = createLiveViewReactServer({
      components: { Greeting: { component: Greeting } },
    });

    await expect(server.render(request as never)).rejects.toThrow(
      "request must use enumerable data properties",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("uses the same bridge-provider and custom-wrapper ordering as the client", async () => {
    function ServerWrapper({ children }: { readonly children: ReactNode }) {
      const bridge = useLiveViewReact();
      return createElement(
        "main",
        { "data-server": bridge.el === null ? "true" : "false" },
        children,
      );
    }

    const wrapRoot = vi.fn(
      ({
        children,
        componentName,
        element,
      }: {
        readonly children: ReactNode;
        readonly componentName: string;
        readonly element: HTMLElement | null;
      }) => {
        expect(componentName).toBe("Greeting");
        expect(element).toBeNull();
        return createElement(ServerWrapper, null, children);
      },
    );
    const server = createLiveViewReactServer({
      components: { Greeting: { component: Greeting } },
      wrapRoot,
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        props: { name: "wrapped" },
      }),
    ).resolves.toBe('<main data-server="true"><p>Hello wrapped</p></main>');
    expect(wrapRoot).toHaveBeenCalledTimes(1);
  });

  it("passes explicit unavailable callbacks under their React prop names", async () => {
    function EventProbe({ onIncrement }: { readonly onIncrement: () => void }) {
      let error = "missing";
      try {
        onIncrement();
      } catch (reason: unknown) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
      return createElement("p", null, error);
    }
    const server = createLiveViewReactServer({
      components: { EventProbe: { component: EventProbe } },
    });

    const html = await server.render({
      ...EMPTY_INITIAL_FRAME_FIELDS,
      component: "EventProbe",
      events: {
        onIncrement: [["push", { event: "increment" }]],
      },
      identifierPrefix: IDENTIFIER_PREFIX,
    });

    expect(html).toContain(
      "Event callback &quot;onIncrement&quot; is unavailable during server rendering or hydration",
    );
  });

  it("rejects ordinary prop collisions with event callback props", async () => {
    const server = createLiveViewReactServer({
      components: { Greeting: { component: Greeting } },
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {
          onIncrement: [["push", { event: "increment" }]],
        },
        identifierPrefix: IDENTIFIER_PREFIX,
        props: { onIncrement: "ordinary" },
      }),
    ).rejects.toThrow("as both ordinary prop and event callback");
  });

  it("rejects ordinary prop collisions with slot props", async () => {
    const server = createLiveViewReactServer({
      components: { Greeting: { component: Greeting } },
    });

    await expect(
      server.render({
        ...EMPTY_INITIAL_FRAME_FIELDS,
        component: "Greeting",
        events: {},
        identifierPrefix: IDENTIFIER_PREFIX,
        props: { children: "ordinary" },
        slots: { default: "<strong>Slot</strong>" },
      }),
    ).rejects.toThrow("as both ordinary prop and slot prop");
  });

  it("keeps server markup stable when StrictMode is enabled", async () => {
    const components = { Greeting: { component: Greeting } };
    const regular = createLiveViewReactServer({ components });
    const strict = createLiveViewReactServer({ components, strictMode: true });
    const request = {
      ...EMPTY_INITIAL_FRAME_FIELDS,
      component: "Greeting",
      events: {},
      identifierPrefix: IDENTIFIER_PREFIX,
      props: { name: "strict" },
    };

    await expect(strict.render(request)).resolves.toBe(
      await regular.render(request),
    );
  });

  it("keeps React preload hints inside the returned HTML", async () => {
    function WithPreloads() {
      preload("/assets/app.css", { as: "style" });
      preloadModule("/assets/app.js", { as: "script" });
      return createElement("p", null, "ready");
    }
    const server = createLiveViewReactServer({
      components: { WithPreloads: { component: WithPreloads } },
    });

    const html = await server.render({
      ...EMPTY_INITIAL_FRAME_FIELDS,
      component: "WithPreloads",
      events: {},
      identifierPrefix: IDENTIFIER_PREFIX,
    });

    expect(html).toContain('<link rel="preload" href="/assets/app.css"');
    expect(html).toContain('<link rel="modulepreload" href="/assets/app.js"');
    expect(html).toContain("<p>ready</p>");
  });

  it("keeps client-only React root callbacks out of server options", () => {
    expectTypeOf<
      "onCaughtError" extends keyof CreateLiveViewReactServerOptions
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "onUncaughtError" extends keyof CreateLiveViewReactServerOptions
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "onRecoverableError" extends keyof CreateLiveViewReactServerOptions
        ? true
        : false
    >().toEqualTypeOf<false>();
  });
});
