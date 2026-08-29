import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Connect, ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";

import { liveViewReactPlugin } from "./vite";

function createRequest(body: unknown): IncomingMessage {
  const request = Object.assign(new EventEmitter(), {
    method: "POST",
    setEncoding: vi.fn(),
    url: "/ssr_render",
  });
  return Object.assign(request, {
    writeBody: () => {
      request.emit("data", JSON.stringify(body));
      request.emit("end");
    },
  }) as unknown as IncomingMessage;
}

describe("Vite SSR middleware", () => {
  it("returns 400 before loading the renderer for invalid slot HTML", async () => {
    const use = vi.fn();
    const ssrLoadModule = vi.fn();
    const plugin = liveViewReactPlugin();
    const configureServer = plugin.configureServer;

    if (typeof configureServer !== "function") {
      throw new Error("Expected a configureServer hook");
    }

    configureServer.call(
      {} as never,
      {
        middlewares: { use },
        ssrLoadModule,
      } as unknown as ViteDevServer,
    );

    const middleware = use.mock.calls[0]?.[0] as
      Connect.NextHandleFunction | undefined;
    if (!middleware) throw new Error("Expected the SSR middleware to register");

    const request = createRequest({
      component: "Example",
      events: {},
      identifierPrefix: "liveview-react-example-",
      props: {},
      slots: { default: "<form><button>Submit</button></form>" },
    });
    const end = vi.fn();
    const response = {
      end,
      setHeader: vi.fn(),
      statusCode: 0,
    } as unknown as ServerResponse;

    const result = middleware(request, response, vi.fn());
    (request as IncomingMessage & { writeBody(): void }).writeBody();
    await result;

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toEqual({
      error: {
        message: 'render request slot "default" contains unsupported forms',
      },
    });
    expect(ssrLoadModule).not.toHaveBeenCalled();
  });
});
