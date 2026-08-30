import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

import type { ServerRenderRequest } from "./server";
import {
  materializeComponentInputs,
  normalizeInitialFrame,
} from "./transport/initialFrame";
import {
  COMPONENTS_VIRTUAL_MODULE_ID,
  generateComponentRegistry,
  isPotentialComponentFile,
  RESOLVED_COMPONENTS_VIRTUAL_MODULE_ID,
  resolveComponentDirectory,
} from "./vite/component-registry";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_COMPONENT_DIRECTORY = "./react-components";
const GENERIC_RENDER_ERROR_MESSAGE = "SSR rendering failed";
const JSON_CONTENT_TYPE_PATTERN =
  /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*[!#$%&'*+\-.^_`|~0-9A-Za-z]+)?$/i;

export interface LiveViewReactPluginOptions {
  readonly componentDirectory?: string;
  readonly entrypoint?: string;
  readonly maxBodyBytes?: number;
  readonly path?: string;
}

interface ValidatedPluginOptions {
  readonly componentDirectory: string;
  readonly entrypoint: string;
  readonly maxBodyBytes: number;
  readonly path: string;
}

class RequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
  }
}

function assertJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !JSON_CONTENT_TYPE_PATTERN.test(contentType.trim())
  ) {
    throw new RequestError(
      415,
      "Content-Type must be application/json with an optional charset parameter",
    );
  }
}

const PLUGIN_OPTION_NAMES: ReadonlySet<string> = new Set([
  "componentDirectory",
  "entrypoint",
  "maxBodyBytes",
  "path",
]);

function validatePluginOptions(options: unknown): ValidatedPluginOptions {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options) ||
    (Object.getPrototypeOf(options) !== Object.prototype &&
      Object.getPrototypeOf(options) !== null)
  ) {
    throw new TypeError("liveViewReactPlugin options must be a plain object");
  }

  const values = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string") {
      throw new TypeError("liveViewReactPlugin option keys must be strings");
    }
    if (!PLUGIN_OPTION_NAMES.has(key)) {
      throw new TypeError(
        `Unknown liveViewReactPlugin option ${JSON.stringify(key)}`,
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        `liveViewReactPlugin option ${JSON.stringify(key)} must be an enumerable data property`,
      );
    }
    values.set(key, descriptor.value);
  }

  const componentDirectory =
    values.get("componentDirectory") === undefined
      ? DEFAULT_COMPONENT_DIRECTORY
      : values.get("componentDirectory");
  const entrypoint =
    values.get("entrypoint") === undefined
      ? "./js/server.ts"
      : values.get("entrypoint");
  const maxBodyBytes =
    values.get("maxBodyBytes") === undefined
      ? DEFAULT_MAX_BODY_BYTES
      : values.get("maxBodyBytes");
  const path =
    values.get("path") === undefined ? "/ssr_render" : values.get("path");

  if (
    typeof componentDirectory !== "string" ||
    componentDirectory.trim().length === 0 ||
    componentDirectory.includes("\0")
  ) {
    throw new TypeError("componentDirectory must be a non-empty path string");
  }
  if (
    typeof entrypoint !== "string" ||
    entrypoint.trim().length === 0 ||
    entrypoint.includes("\0")
  ) {
    throw new TypeError("entrypoint must be a non-empty module id string");
  }
  if (!Number.isSafeInteger(maxBodyBytes) || (maxBodyBytes as number) <= 0) {
    throw new TypeError("maxBodyBytes must be a positive safe integer");
  }
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\0")
  ) {
    throw new TypeError(
      "path must be an absolute URL path without a query, fragment, or null byte",
    );
  }

  return Object.freeze({
    componentDirectory,
    entrypoint,
    maxBodyBytes: maxBodyBytes as number,
    path,
  });
}

function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodyBytes = 0;
    let failed = false;

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (failed) return;

      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBodyBytes) {
        failed = true;
        reject(new RequestError(413, "Request body is too large"));
        return;
      }

      body += chunk;
    });
    request.on("end", () => {
      if (failed) return;

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new RequestError(400, "Invalid JSON"));
      }
    });
    request.on("error", (error) => {
      if (failed) return;
      failed = true;
      reject(error);
    });
    request.on("aborted", () => {
      if (failed) return;
      failed = true;
      reject(new RequestError(400, "Request was aborted"));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRenderRequest(value: unknown): ServerRenderRequest {
  try {
    const frame = normalizeInitialFrame(value, "render request");
    materializeComponentInputs(frame, "render request");
    return frame;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestError(400, message);
  }
}

function resolveRenderer(
  module: unknown,
): (request: ServerRenderRequest) => string | Promise<string> {
  if (!isRecord(module) || typeof module.render !== "function") {
    throw new TypeError("SSR entrypoint must export a render function");
  }

  return module.render as (
    request: ServerRenderRequest,
  ) => string | Promise<string>;
}

function configureComponentRegistryInvalidation(
  server: ViteDevServer,
  componentDirectory: string,
): void {
  server.watcher.add(componentDirectory);

  const invalidate = (file: string): void => {
    if (!isPotentialComponentFile(componentDirectory, file)) return;

    const virtualModule = server.moduleGraph.getModuleById(
      RESOLVED_COMPONENTS_VIRTUAL_MODULE_ID,
    );
    if (!virtualModule) return;

    server.moduleGraph.invalidateModule(
      virtualModule,
      new Set(),
      Date.now(),
      true,
    );
    server.ws.send({ type: "full-reload" });
  };

  const cleanup = (): void => {
    server.watcher.off("add", invalidate);
    server.watcher.off("unlink", invalidate);
    server.watcher.off("close", cleanup);
    server.httpServer?.off("close", cleanup);
  };

  server.watcher.on("add", invalidate);
  server.watcher.on("unlink", invalidate);
  server.watcher.once("close", cleanup);
  server.httpServer?.once("close", cleanup);
}

export function liveViewReactPlugin(
  options: LiveViewReactPluginOptions = {},
): Plugin {
  const { componentDirectory, entrypoint, maxBodyBytes, path } =
    validatePluginOptions(options);
  let resolvedViteRoot: string | null = null;

  return {
    name: "liveview-react",

    configResolved(config) {
      resolveComponentDirectory(config.root, componentDirectory);
      resolvedViteRoot = config.root;
    },

    resolveId(source) {
      if (source === COMPONENTS_VIRTUAL_MODULE_ID) {
        return RESOLVED_COMPONENTS_VIRTUAL_MODULE_ID;
      }
      return null;
    },

    async load(id) {
      if (id !== RESOLVED_COMPONENTS_VIRTUAL_MODULE_ID) return null;
      if (!resolvedViteRoot) {
        throw new Error(
          `Vite config must be resolved before loading ${JSON.stringify(COMPONENTS_VIRTUAL_MODULE_ID)}`,
        );
      }

      const registry = await generateComponentRegistry(
        resolveComponentDirectory(resolvedViteRoot, componentDirectory),
      );
      for (const file of registry.files) this.addWatchFile(file);
      return registry.code;
    },

    configureServer(server) {
      if (resolvedViteRoot) {
        configureComponentRegistryInvalidation(
          server,
          resolveComponentDirectory(resolvedViteRoot, componentDirectory),
        );
      }

      // Connect ignores handler return values, while returning this Promise lets
      // callers and tests await completion without changing runtime behavior.
      // oxlint-disable-next-line typescript/no-misused-promises
      server.middlewares.use(async (request, response, next) => {
        const requestPath = request.url?.split("?", 1)[0];
        if (request.method !== "POST" || requestPath !== path) {
          next();
          return;
        }

        try {
          assertJsonContentType(request);
          const body = await readJsonBody(request, maxBodyBytes);
          const renderRequest = parseRenderRequest(body);
          const loadedModule = await server.ssrLoadModule(entrypoint);
          const html = await resolveRenderer(loadedModule)(renderRequest);

          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(html);
        } catch (error: unknown) {
          if (error instanceof RequestError) {
            jsonResponse(response, error.statusCode, {
              error: { message: error.message },
            });
            return;
          }

          const reason =
            error instanceof Error ? error : new Error(String(error));
          server.ssrFixStacktrace(reason);
          server.config.logger.error(reason.stack ?? reason.message);
          jsonResponse(response, 500, {
            error: { message: GENERIC_RENDER_ERROR_MESSAGE },
          });
        }
      });
    },
  };
}

export default liveViewReactPlugin;
