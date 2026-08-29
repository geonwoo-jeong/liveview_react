import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createLiveViewReactServer } from "./server";

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
});
