import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build, type Connect, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { liveViewReactPlugin } from "./vite";

const VIRTUAL_COMPONENTS_ID = "virtual:liveview-react/components";
const RESOLVED_VIRTUAL_COMPONENTS_ID = `\0${VIRTUAL_COMPONENTS_ID}`;
const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "liveview-react-vite-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeFixture(root: string, path: string): Promise<string> {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "export default function Component() {}\n");
  return absolutePath;
}

function callConfigResolved(
  plugin: ReturnType<typeof liveViewReactPlugin>,
  root: string,
): void {
  if (typeof plugin.configResolved !== "function") {
    throw new Error("Expected a configResolved hook");
  }
  plugin.configResolved.call({} as never, { root } as never);
}

async function callResolveId(
  plugin: ReturnType<typeof liveViewReactPlugin>,
  source: string,
): Promise<unknown> {
  if (typeof plugin.resolveId !== "function") {
    throw new Error("Expected a resolveId hook");
  }
  return plugin.resolveId.call({} as never, source, undefined, {
    isEntry: false,
  });
}

async function callLoad(
  plugin: ReturnType<typeof liveViewReactPlugin>,
  id: string,
  addWatchFile = vi.fn(),
): Promise<{
  readonly addWatchFile: typeof addWatchFile;
  readonly code: unknown;
}> {
  if (typeof plugin.load !== "function") {
    throw new Error("Expected a load hook");
  }
  const code = await plugin.load.call({ addWatchFile } as never, id, {});
  return { addWatchFile, code };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function createRequest(
  body: unknown,
  contentType: string | null = "application/json",
): IncomingMessage {
  const request = Object.assign(new EventEmitter(), {
    headers: contentType === null ? {} : { "content-type": contentType },
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

function renderFrame(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    version: 2,
    component: "Example",
    identifierPrefix: "liveview-react-example-",
    props: {},
    streams: {},
    events: {},
    slots: {},
    ...overrides,
  };
}

describe("Vite virtual component registry", () => {
  it("resolves only the public virtual id and loads the default component directory", async () => {
    const root = await temporaryRoot();
    const component = await writeFixture(
      root,
      "react-components/Admin/UserCard.tsx",
    );
    const plugin = liveViewReactPlugin();
    callConfigResolved(plugin, root);
    expect(plugin.handleHotUpdate).toBeUndefined();

    await expect(callResolveId(plugin, VIRTUAL_COMPONENTS_ID)).resolves.toBe(
      RESOLVED_VIRTUAL_COMPONENTS_ID,
    );
    await expect(
      callResolveId(plugin, "virtual:unrelated"),
    ).resolves.toBeNull();
    const loaded = await callLoad(plugin, RESOLVED_VIRTUAL_COMPONENTS_ID);

    expect(loaded.code).toContain(
      '"Admin/UserCard": Object.freeze({ component: LiveViewReactComponent0 })',
    );
    expect(loaded.addWatchFile).toHaveBeenCalledTimes(1);
    expect(loaded.addWatchFile).toHaveBeenCalledWith(component);
    await expect(callLoad(plugin, "unrelated")).resolves.toMatchObject({
      code: null,
    });
  });

  it("builds a Vite consumer that imports the virtual registry", async () => {
    const root = await temporaryRoot();
    await writeFixture(root, "react-components/Admin/UserCard.tsx");
    await writeFile(
      join(root, "main.ts"),
      [
        `import Components from ${JSON.stringify(VIRTUAL_COMPONENTS_ID)};`,
        "globalThis.__components = Components;",
        "",
      ].join("\n"),
    );

    await expect(
      build({
        build: {
          copyPublicDir: false,
          rollupOptions: { input: join(root, "main.ts") },
          write: false,
        },
        configFile: false,
        logLevel: "silent",
        plugins: [liveViewReactPlugin()],
        root,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects component directories outside the resolved Vite root", async () => {
    const root = await temporaryRoot();
    const plugin = liveViewReactPlugin({ componentDirectory: "../outside" });

    expect(() => callConfigResolved(plugin, root)).toThrow(
      'componentDirectory must stay within the Vite root; received "../outside"',
    );
  });

  it.each([
    [null, "liveViewReactPlugin options must be a plain object"],
    [
      { componentDirectory: null },
      "componentDirectory must be a non-empty path string",
    ],
    [
      { componentDirectory: "" },
      "componentDirectory must be a non-empty path string",
    ],
    [{ entrypoint: "" }, "entrypoint must be a non-empty module id string"],
    [{ maxBodyBytes: 0 }, "maxBodyBytes must be a positive safe integer"],
    [
      { path: "ssr_render" },
      "path must be an absolute URL path without a query, fragment, or null byte",
    ],
    [{ unsupported: true }, 'Unknown liveViewReactPlugin option "unsupported"'],
  ])("validates plugin options without coercion: %o", (options, message) => {
    expect(() => liveViewReactPlugin(options as never)).toThrow(message);
  });

  it("does not invoke option accessors", () => {
    const getter = vi.fn(() => "./components");
    const options = Object.defineProperty({}, "componentDirectory", {
      enumerable: true,
      get: getter,
    });

    expect(() => liveViewReactPlugin(options)).toThrow(
      'liveViewReactPlugin option "componentDirectory" must be an enumerable data property',
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("invalidates the virtual module on eligible add and unlink events and removes listeners", async () => {
    const root = await temporaryRoot();
    const plugin = liveViewReactPlugin();
    callConfigResolved(plugin, root);
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const httpServer = new EventEmitter();
    const virtualModule = { id: RESOLVED_VIRTUAL_COMPONENTS_ID };
    const getModuleById = vi.fn(() => virtualModule);
    const invalidateModule = vi.fn();
    const send = vi.fn();
    const use = vi.fn();

    if (typeof plugin.configureServer !== "function") {
      throw new Error("Expected a configureServer hook");
    }
    plugin.configureServer.call(
      {} as never,
      {
        httpServer,
        middlewares: { use },
        moduleGraph: { getModuleById, invalidateModule },
        watcher,
        ws: { send },
      } as unknown as ViteDevServer,
    );

    expect(watcher.add).toHaveBeenCalledWith(join(root, "react-components"));
    expect(watcher.listenerCount("add")).toBe(1);
    expect(watcher.listenerCount("unlink")).toBe(1);
    expect(watcher.listenerCount("close")).toBe(1);
    expect(httpServer.listenerCount("close")).toBe(1);

    watcher.emit("add", join(root, "react-components/NewCard.tsx"));
    watcher.emit("unlink", join(root, "react-components/OldCard.jsx"));
    watcher.emit("add", join(root, "react-components/Card.test.tsx"));
    watcher.emit("add", join(root, "outside/Outside.tsx"));

    expect(getModuleById).toHaveBeenCalledTimes(2);
    expect(getModuleById).toHaveBeenCalledWith(RESOLVED_VIRTUAL_COMPONENTS_ID);
    expect(invalidateModule).toHaveBeenCalledTimes(2);
    expect(invalidateModule).toHaveBeenCalledWith(
      virtualModule,
      expect.any(Set),
      expect.any(Number),
      true,
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ type: "full-reload" });

    httpServer.emit("close");
    expect(watcher.listenerCount("add")).toBe(0);
    expect(watcher.listenerCount("unlink")).toBe(0);
    expect(watcher.listenerCount("close")).toBe(0);
    expect(httpServer.listenerCount("close")).toBe(0);
  });
});

describe("Vite SSR middleware", () => {
  it.each([
    ["missing", null],
    ["unsupported", "text/plain"],
    ["malformed", "application/json; charset"],
  ])(
    "returns 415 before loading the renderer for a %s Content-Type",
    async (_description, contentType) => {
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
        | Connect.NextHandleFunction
        | undefined;
      if (!middleware) {
        throw new Error("Expected the SSR middleware to register");
      }

      const request = createRequest(renderFrame(), contentType);
      const end = vi.fn();
      const response = {
        end,
        setHeader: vi.fn(),
        statusCode: 0,
      } as unknown as ServerResponse;

      await middleware(request, response, vi.fn());

      expect(response.statusCode).toBe(415);
      expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toEqual({
        error: {
          message:
            "Content-Type must be application/json with an optional charset parameter",
        },
      });
      expect(ssrLoadModule).not.toHaveBeenCalled();
      expect(request.setEncoding).not.toHaveBeenCalled();
    },
  );

  it("accepts application/json with a charset parameter", async () => {
    const use = vi.fn();
    const render = vi.fn(() => "<main>Hello</main>");
    const ssrLoadModule = vi.fn(async () => ({
      render,
    }));
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
      | Connect.NextHandleFunction
      | undefined;
    if (!middleware) throw new Error("Expected the SSR middleware to register");

    const request = createRequest(
      renderFrame({
        streams: { users: [{ __dom_id: "users-1", name: "Ada" }] },
      }),
      "application/json; charset=utf-8",
    );
    const end = vi.fn();
    const response = {
      end,
      setHeader: vi.fn(),
      statusCode: 0,
    } as unknown as ServerResponse;

    const result = middleware(request, response, vi.fn());
    (request as IncomingMessage & { writeBody(): void }).writeBody();
    await result;

    expect(response.statusCode).toBe(200);
    expect(end).toHaveBeenCalledWith("<main>Hello</main>");
    expect(ssrLoadModule).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        streams: { users: [{ __dom_id: "users-1", name: "Ada" }] },
      }),
    );
  });

  it("returns a generic 500 response while logging renderer details", async () => {
    const sensitiveError = new Error("SECRET:/srv/app/.env");
    const logger = { error: vi.fn() };
    const ssrFixStacktrace = vi.fn();
    const use = vi.fn();
    const ssrLoadModule = vi.fn(async () => ({
      render: () => {
        throw sensitiveError;
      },
    }));
    const plugin = liveViewReactPlugin();
    const configureServer = plugin.configureServer;

    if (typeof configureServer !== "function") {
      throw new Error("Expected a configureServer hook");
    }

    configureServer.call(
      {} as never,
      {
        config: { logger },
        middlewares: { use },
        ssrFixStacktrace,
        ssrLoadModule,
      } as unknown as ViteDevServer,
    );

    const middleware = use.mock.calls[0]?.[0] as
      | Connect.NextHandleFunction
      | undefined;
    if (!middleware) throw new Error("Expected the SSR middleware to register");

    const request = createRequest(renderFrame());
    const end = vi.fn();
    const response = {
      end,
      setHeader: vi.fn(),
      statusCode: 0,
    } as unknown as ServerResponse;

    const result = middleware(request, response, vi.fn());
    (request as IncomingMessage & { writeBody(): void }).writeBody();
    await result;

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toEqual({
      error: { message: "SSR rendering failed" },
    });
    expect(String(end.mock.calls[0]?.[0])).not.toContain(
      sensitiveError.message,
    );
    expect(ssrFixStacktrace).toHaveBeenCalledWith(sensitiveError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(sensitiveError.message),
    );
  });

  it.each([
    [
      "invalid slot HTML",
      renderFrame({
        slots: { default: "<form><button>Submit</button></form>" },
      }),
      'render request slot "default" contains unsupported forms',
    ],
    ["transport v1", renderFrame({ version: 1 }), "version must be 2"],
    [
      "a malformed stream item",
      renderFrame({ streams: { users: [{ name: "missing id" }] } }),
      "__dom_id must be a non-empty string",
    ],
    [
      "a cross-namespace collision",
      renderFrame({ props: { users: [] }, streams: { users: [] } }),
      "as both ordinary prop and stream prop",
    ],
  ])(
    "returns 400 before loading the renderer for %s",
    async (_label, body, message) => {
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
        | Connect.NextHandleFunction
        | undefined;
      if (!middleware)
        throw new Error("Expected the SSR middleware to register");

      const request = createRequest(body);
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
        error: { message: expect.stringContaining(message) },
      });
      expect(ssrLoadModule).not.toHaveBeenCalled();
    },
  );

  it("serves SSR while the virtual component registry is configured", async () => {
    const root = await temporaryRoot();
    await writeFixture(root, "react-components/Greeting.tsx");
    const plugin = liveViewReactPlugin();
    callConfigResolved(plugin, root);
    const loadedRegistry = await callLoad(
      plugin,
      RESOLVED_VIRTUAL_COMPONENTS_ID,
    );
    expect(loadedRegistry.code).toContain('"Greeting": Object.freeze({');

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const use = vi.fn();
    const ssrLoadModule = vi.fn(async () => ({
      render: () => "<main>Hello</main>",
    }));
    if (typeof plugin.configureServer !== "function") {
      throw new Error("Expected a configureServer hook");
    }
    plugin.configureServer.call(
      {} as never,
      {
        config: { logger: { error: vi.fn() } },
        middlewares: { use },
        moduleGraph: { getModuleById: vi.fn() },
        ssrFixStacktrace: vi.fn(),
        ssrLoadModule,
        watcher,
        ws: { send: vi.fn() },
      } as unknown as ViteDevServer,
    );

    const middleware = use.mock.calls[0]?.[0] as
      | Connect.NextHandleFunction
      | undefined;
    if (!middleware) throw new Error("Expected the SSR middleware to register");
    const request = createRequest(
      renderFrame({
        component: "Greeting",
        identifierPrefix: "liveview-react-greeting-",
        props: { name: "World" },
      }),
    );
    const end = vi.fn();
    const response = {
      end,
      setHeader: vi.fn(),
      statusCode: 0,
    } as unknown as ServerResponse;

    const result = middleware(request, response, vi.fn());
    (request as IncomingMessage & { writeBody(): void }).writeBody();
    await result;

    expect(response.statusCode).toBe(200);
    expect(end).toHaveBeenCalledWith("<main>Hello</main>");
    expect(ssrLoadModule).toHaveBeenCalledWith("./js/server.ts");
  });
});
