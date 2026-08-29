import { createElement, type ReactNode } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { useLiveViewReact } from "./context";
import {
  createLiveViewReactServer,
  type CreateLiveViewReactServerOptions,
} from "./server";

interface GreetingProps {
  readonly name?: string;
}

function Greeting({ name = "world" }: GreetingProps) {
  return createElement("p", null, `Hello ${name}`);
}

describe("createLiveViewReactServer", () => {
  it("renders a tagged eager component", async () => {
    const server = createLiveViewReactServer({
      components: { Greeting: { component: Greeting } },
    });

    await expect(
      server.render({ component: "Greeting", props: { name: "LiveView" } }),
    ).resolves.toBe("<p>Hello LiveView</p>");
  });

  it("renders a tagged lazy component", async () => {
    const server = createLiveViewReactServer({
      components: {
        Greeting: { load: async () => ({ default: Greeting }) },
      },
    });

    await expect(
      server.render({ component: "Greeting", props: { name: "React" } }),
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
        component: "Card",
        slots: { default: "<strong>Server slot</strong>" },
      }),
    ).resolves.toBe(
      "<section><div><strong>Server slot</strong></div></section>",
    );
  });

  it("rejects an unknown component", async () => {
    const server = createLiveViewReactServer({ components: {} });

    await expect(server.render({ component: "Missing" })).rejects.toThrow(
      'Component "Missing" is not registered',
    );
  });

  it.each([
    [null, "server render request must be a plain object"],
    [{ component: "" }, "component must be a non-empty string"],
    [{ component: "Greeting", props: [] }, "props must be a plain object"],
    [
      { component: "Greeting", slots: { default: 1 } },
      'slot "default" must be a string',
    ],
    [
      { component: "Greeting", unexpected: true },
      'Unknown server render request field "unexpected"',
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
      server.render({ component: "Greeting", props: { name: "wrapped" } }),
    ).resolves.toBe('<main data-server="true"><p>Hello wrapped</p></main>');
    expect(wrapRoot).toHaveBeenCalledTimes(1);
  });

  it("keeps server markup stable when StrictMode is enabled", async () => {
    const components = { Greeting: { component: Greeting } };
    const regular = createLiveViewReactServer({ components });
    const strict = createLiveViewReactServer({ components, strictMode: true });
    const request = { component: "Greeting", props: { name: "strict" } };

    await expect(strict.render(request)).resolves.toBe(
      await regular.render(request),
    );
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
