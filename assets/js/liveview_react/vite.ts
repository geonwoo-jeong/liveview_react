import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import {
  assertNoEventPropCollisions,
  normalizeEventCommandMap,
} from "./runtime/event-callbacks";
import type { ServerRenderRequest } from "./server";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const SERVER_RENDER_FIELDS: readonly string[] = Object.freeze([
  "component",
  "events",
  "identifierPrefix",
  "props",
  "slots",
]);

export interface LiveViewReactPluginOptions {
  readonly entrypoint?: string;
  readonly maxBodyBytes?: number;
  readonly path?: string;
}

class RequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
  }
}

function hotUpdateType(path: string | null): "css-update" | "js-update" | null {
  if (!path) return null;
  if (path.endsWith(".css")) return "css-update";
  if (/\.[cm]?[jt]sx?$/.test(path)) return "js-update";
  return null;
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
  if (!isRecord(value)) {
    throw new RequestError(400, "request body must be an object");
  }

  const unknownField = Object.keys(value).find(
    (key) => !SERVER_RENDER_FIELDS.includes(key),
  );
  if (unknownField) {
    throw new RequestError(
      400,
      `Unknown render request field "${unknownField}"`,
    );
  }

  if (typeof value.component !== "string" || value.component.length === 0) {
    throw new RequestError(400, "component must be a non-empty string");
  }

  if (
    typeof value.identifierPrefix !== "string" ||
    value.identifierPrefix.length === 0
  ) {
    throw new RequestError(400, "identifierPrefix must be a non-empty string");
  }

  if (value.props !== undefined && !isRecord(value.props)) {
    throw new RequestError(400, "props must be an object");
  }

  let events: ServerRenderRequest["events"];
  try {
    events = normalizeEventCommandMap(value.events, "render request events");
    assertNoEventPropCollisions(
      (value.props ?? {}) as Record<string, unknown>,
      events,
      "render request",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestError(400, message);
  }

  if (value.slots !== undefined) {
    if (!isRecord(value.slots)) {
      throw new RequestError(400, "slots must be an object");
    }

    for (const slot of Object.values(value.slots)) {
      if (typeof slot !== "string") {
        throw new RequestError(400, "slot values must be strings");
      }
    }
  }

  const renderRequest: ServerRenderRequest = {
    component: value.component,
    events,
    identifierPrefix: value.identifierPrefix,
    ...(value.props ? { props: value.props } : {}),
    ...(value.slots ? { slots: value.slots as Record<string, string> } : {}),
  };
  return renderRequest;
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

export function liveViewReactPlugin(
  options: LiveViewReactPluginOptions = {},
): Plugin {
  const path = options.path ?? "/ssr_render";
  const entrypoint = options.entrypoint ?? "./js/server.ts";
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError("maxBodyBytes must be a positive safe integer");
  }

  return {
    name: "liveview-react",

    handleHotUpdate({ file, modules, server, timestamp }) {
      if (!/\.(heex|ex)$/.test(file)) return;

      const invalidatedModules = new Set<(typeof modules)[number]>();
      for (const module of modules) {
        server.moduleGraph.invalidateModule(
          module,
          invalidatedModules,
          timestamp,
          true,
        );
      }

      const updates = Array.from(invalidatedModules).flatMap((module) => {
        const type = hotUpdateType(module.file);
        if (!type) return [];

        return [
          {
            type,
            path: module.url,
            acceptedPath: module.url,
            timestamp,
          },
        ];
      });

      if (updates.length > 0) {
        server.ws.send({ type: "update", updates });
      }

      return [];
    },

    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestPath = request.url?.split("?", 1)[0];
        if (request.method !== "POST" || requestPath !== path) {
          next();
          return;
        }

        try {
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
            error: { message: reason.message },
          });
        }
      });
    },
  };
}

export default liveViewReactPlugin;
