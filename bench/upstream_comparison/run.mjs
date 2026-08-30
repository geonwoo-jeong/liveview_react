import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import React, { act, useEffect, useState } from "react";

import {
  assertInvariant,
  measureCase,
  nowIso,
  parseArgs,
  readJson,
  safeWriteJson,
  safeWriteText,
} from "./shared.mjs";
import {
  DEFAULT_BENCHMARK_OPTIONS,
  DEFAULT_WORKSPACE,
  PREPARE_MANIFEST,
  RESULT_JSON,
  RESULT_MARKDOWN,
  TARGETS,
} from "./config.mjs";

const options = parseArgs(process.argv);
const workspace = path.resolve(options.workspace ?? DEFAULT_WORKSPACE);
const outputDirectory = path.resolve(
  options.output ??
    path.join(process.cwd(), "bench/upstream_comparison/results"),
);
let nextFixtureId = 0;

function currentIdentifierPrefix(rootId) {
  return `liveview-react-${rootId}-`;
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});

async function main() {
  const manifest = readJson(path.join(workspace, PREPARE_MANIFEST));
  assertInvariant(
    manifest.targets[TARGETS.current.id]?.kind === "current",
    "prepare manifest is missing the current target",
  );

  const selectedTargets = options.target
    ? Object.fromEntries(
        Object.entries(manifest.targets).filter(
          ([id]) => id === options.target,
        ),
      )
    : manifest.targets;
  assertInvariant(
    Object.keys(selectedTargets).length > 0,
    `Unknown target: ${options.target ?? "<none>"}`,
  );

  if (!options.target && Object.keys(selectedTargets).length > 1) {
    const aggregatedResults = {};
    let environment = null;

    for (const targetId of Object.keys(selectedTargets)) {
      const targetOutput = path.join(outputDirectory, `${targetId}.json`);
      execFileSync(
        process.execPath,
        [
          ...process.execArgv,
          "bench/upstream_comparison/run.mjs",
          "--offline",
          "--workspace",
          workspace,
          "--target",
          targetId,
          "--output",
          targetOutput,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "inherit",
        },
      );
      const childPayload = readJson(targetOutput);
      environment = environment ?? childPayload.environment;
      Object.assign(aggregatedResults, childPayload.results);
    }

    const payload = Object.freeze({
      benchmarkedAt: nowIso(),
      configuration: DEFAULT_BENCHMARK_OPTIONS,
      environment,
      results: aggregatedResults,
    });
    safeWriteJson(path.join(outputDirectory, RESULT_JSON), payload);
    safeWriteText(
      path.join(outputDirectory, RESULT_MARKDOWN),
      renderMarkdown(payload),
    );
    return;
  }

  installDom();
  const environment = collectEnvironment(manifest);
  const targets = await Promise.all(
    Object.entries(selectedTargets).map(async ([id, target]) => [
      id,
      await loadTarget({ id, ...target }),
    ]),
  );
  const results = {};
  globalThis.__benchCurrentApi = null;

  for (const [id, target] of targets) {
    results[id] = await benchmarkTarget(target);
  }

  const payload = Object.freeze({
    benchmarkedAt: nowIso(),
    configuration: DEFAULT_BENCHMARK_OPTIONS,
    environment,
    results,
  });
  const outputFile = outputDirectory.endsWith(".json")
    ? outputDirectory
    : path.join(outputDirectory, RESULT_JSON);
  safeWriteJson(outputFile, payload);
  if (!outputDirectory.endsWith(".json")) {
    safeWriteText(
      path.join(outputDirectory, RESULT_MARKDOWN),
      renderMarkdown(payload),
    );
  }
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/bench",
  });
  const win = dom.window;
  globalThis.window = win;
  globalThis.document = win.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: win.navigator,
  });
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.HTMLInputElement = win.HTMLInputElement;
  globalThis.HTMLTextAreaElement = win.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = win.HTMLSelectElement;
  globalThis.HTMLOptionElement = win.HTMLOptionElement;
  globalThis.HTMLCanvasElement = win.HTMLCanvasElement;
  globalThis.CustomEvent = win.CustomEvent;
  globalThis.MutationObserver = win.MutationObserver;
  globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win);
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

function collectEnvironment(manifest) {
  return Object.freeze({
    node: process.version,
    platform: process.platform,
    preparedAt: manifest.preparedAt,
    repositoryRoot: manifest.repositoryRoot,
    workspace: manifest.workspace,
  });
}

async function loadTarget(target) {
  if (target.kind === "current") {
    const rootDir = target.rootDir;
    const resolvedClientEntry = pathToFileURL(
      path.join(rootDir, target.clientEntry),
    ).href;
    const resolvedServerEntry = pathToFileURL(
      path.join(rootDir, target.serverEntry),
    ).href;
    const clientModule = await import(resolvedClientEntry);
    const serverModule = await import(resolvedServerEntry);
    return Object.freeze({
      ...target,
      clientModule,
      id: TARGETS.current.id,
      serverModule,
    });
  }

  const normalized = normalizeLegacyTarget(target);
  const resolvedClientEntry = pathToFileURL(
    path.join(normalized.rootDir, normalized.clientEntry),
  ).href;
  const resolvedServerEntry = pathToFileURL(
    path.join(normalized.rootDir, normalized.serverEntry),
  ).href;
  const clientModule = await import(resolvedClientEntry);
  const serverModule = await import(resolvedServerEntry);
  return Object.freeze({
    ...target,
    clientModule,
    rootDir: normalized.rootDir,
    serverModule,
  });
}

function normalizeLegacyTarget(target) {
  const normalizedRoot = path.join(workspace, "normalized", target.id);
  rmSync(normalizedRoot, { force: true, recursive: true });
  mkdirSync(path.dirname(normalizedRoot), { recursive: true });
  cpSync(target.rootDir, normalizedRoot, { recursive: true });
  writeFileSync(
    path.join(normalizedRoot, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
    "utf8",
  );
  const nestedPackageRoot = path.join(normalizedRoot, "package");
  if (statDirectoryExists(nestedPackageRoot)) {
    writeFileSync(
      path.join(nestedPackageRoot, "package.json"),
      `${JSON.stringify({ type: "module" }, null, 2)}\n`,
      "utf8",
    );
  }
  const moduleDirectories = new Set([
    path.join(normalizedRoot, path.dirname(target.clientEntry)),
    path.join(normalizedRoot, path.dirname(target.serverEntry)),
  ]);
  for (const directory of moduleDirectories) rewriteLegacyTree(directory);
  return Object.freeze({
    clientEntry: target.clientEntry.replace(/\.jsx$/u, ".js"),
    rootDir: normalizedRoot,
    serverEntry: target.serverEntry.replace(/\.jsx$/u, ".js"),
  });
}

function rewriteLegacyTree(rootDir) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      rewriteLegacyTree(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name);
    if (![".js", ".mjs", ".jsx"].includes(extension)) continue;

    const source = readFileSync(fullPath, "utf8");
    const rewritten = rewriteRelativeSpecifiers(source, fullPath);
    if (extension === ".jsx") {
      writeFileSync(
        fullPath.replace(/\.jsx$/u, ".js"),
        transpileKnownJsx(fullPath),
        "utf8",
      );
      continue;
    }

    writeFileSync(fullPath, rewritten, "utf8");
  }
}

function rewriteRelativeSpecifiers(source, filePath) {
  return source.replace(
    /(from\s+["']|import\s*\(\s*["']|export\s+\*\s+from\s+["']|export\s+\{[^}]+\}\s+from\s+["'])(\.[^"']+)(["'])/gu,
    (fullMatch, prefix, specifier, suffix) => {
      const resolved = resolveLegacySpecifier(filePath, specifier);
      if (resolved === specifier) return fullMatch;
      return `${prefix}${resolved}${suffix}`;
    },
  );
}

function resolveLegacySpecifier(filePath, specifier) {
  const directory = path.dirname(filePath);
  if (specifier.endsWith(".jsx")) {
    const jsxSource = path.resolve(directory, specifier);
    if (statExists(jsxSource)) {
      return `${specifier.slice(0, -".jsx".length)}.js`;
    }
    return specifier;
  }
  if (path.extname(specifier)) return specifier;

  const candidates = [".js", ".mjs", ".jsx"];
  for (const extension of candidates) {
    const candidate = path.resolve(directory, `${specifier}${extension}`);
    if (statExists(candidate)) {
      return extension === ".jsx"
        ? `${specifier}.js`
        : `${specifier}${extension}`;
    }
  }
  throw new Error(
    `Could not resolve legacy import "${specifier}" from ${filePath}`,
  );
}

function statExists(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function statDirectoryExists(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function transpileKnownJsx(filePath) {
  const name = path.basename(filePath);

  if (name === "context.jsx") {
    return [
      'import React, { createContext, useContext } from "react";',
      "",
      "export const LiveReactContext = createContext(null);",
      "",
      "export function LiveReactProvider({ children, ...props }) {",
      "  return React.createElement(",
      "    LiveReactContext.Provider,",
      "    { value: props },",
      "    children,",
      "  );",
      "}",
      "",
      "export function useLiveReact() {",
      "  return useContext(LiveReactContext);",
      "}",
      "",
    ].join("\n");
  }

  if (name === "link.jsx") {
    return [
      'import React, { useMemo } from "react";',
      "",
      "export function Link({",
      "  href = null,",
      "  patch = null,",
      "  navigate = null,",
      "  replace = false,",
      "  children,",
      "  ...attrs",
      "}) {",
      "  const linkAttrs = useMemo(() => {",
      "    if (!patch && !navigate) {",
      '      return { href: href || "#" };',
      "    }",
      "",
      "    return {",
      '      href: (navigate ? navigate : patch) || "#",',
      '      "data-phx-link": navigate ? "redirect" : "patch",',
      '      "data-phx-link-state": replace ? "replace" : "push",',
      "    };",
      "  }, [href, patch, navigate, replace]);",
      "",
      '  return React.createElement("a", { ...attrs, ...linkAttrs }, children);',
      "}",
      "",
    ].join("\n");
  }

  throw new Error(`Unsupported legacy JSX module: ${filePath}`);
}

async function benchmarkTarget(target) {
  const client = await createClientAdapter(target);
  const server = createServerAdapter(target);
  const metrics = Object.freeze({
    package: target.packageInfo,
    support: client.support,
    cases: {},
  });

  metrics.cases.mount = await measureCase({
    ...DEFAULT_BENCHMARK_OPTIONS,
    batch: async () => {
      for (let index = 0; index < 25; index += 1) {
        const fixture = client.createMountFixture({ value: index });
        await fixture.mount();
        await fixture.destroy();
      }
    },
    iterationsPerSample: 25,
    name: "mount",
  });

  metrics.cases.hydration = await measureCase({
    ...DEFAULT_BENCHMARK_OPTIONS,
    batch: async () => {
      for (let index = 0; index < 20; index += 1) {
        const fixture = await client.createHydrationFixture(server, {
          value: index,
        });
        await fixture.mount();
        await fixture.destroy();
      }
    },
    iterationsPerSample: 20,
    name: "hydration",
  });

  metrics.cases.propsUpdate = await measureCase({
    ...DEFAULT_BENCHMARK_OPTIONS,
    batch: async () => {
      const fixture = client.createMountFixture({ value: 0 });
      await fixture.mount();
      for (let index = 1; index <= 40; index += 1) {
        await fixture.update({ value: index });
      }
      await fixture.destroy();
    },
    iterationsPerSample: 40,
    name: "props-update",
  });

  metrics.cases.multiRoot = await measureCase({
    ...DEFAULT_BENCHMARK_OPTIONS,
    batch: async () => {
      const fixtures = Array.from({ length: 12 }, (_, index) =>
        client.createMountFixture({ value: index }),
      );
      for (const fixture of fixtures) await fixture.mount();
      for (const fixture of fixtures) await fixture.destroy();
    },
    iterationsPerSample: 12,
    name: "multi-root",
  });

  metrics.cases.destroyRemount = await measureCase({
    ...DEFAULT_BENCHMARK_OPTIONS,
    batch: async () => {
      for (let index = 0; index < 30; index += 1) {
        const fixture = client.createMountFixture({ value: index });
        await fixture.mount();
        await fixture.destroy();
      }
    },
    iterationsPerSample: 30,
    name: "destroy-remount",
  });

  metrics.cases.ssr = await measureCase({
    ...DEFAULT_BENCHMARK_OPTIONS,
    batch: async () => {
      for (let index = 0; index < 100; index += 1) {
        const html = await server.render({ value: index });
        assertInvariant(
          typeof html === "string" && html.length > 0,
          "SSR must return markup",
        );
      }
    },
    iterationsPerSample: 100,
    name: "ssr",
  });

  metrics.cases.streams = client.support.streams
    ? await measureCase({
        ...DEFAULT_BENCHMARK_OPTIONS,
        batch: async () => {
          const fixture = client.createStreamFixture();
          await fixture.mount();
          for (let index = 0; index < 10; index += 1) {
            await fixture.update(index * 25);
          }
          await fixture.destroy();
        },
        iterationsPerSample: 10,
        name: "stream-update",
      })
    : unsupported(
        "stream transport is not implemented in this shipped client surface",
      );

  metrics.cases.eventBridge = client.support.eventBridge
    ? await client.measureEventBridge()
    : unsupported(
        "event bridge surface is not comparable across package generations",
      );

  metrics.cases.listenerBalance = client.support.listenerBalance
    ? await client.measureListenerBalance()
    : unsupported(
        "the shipped client does not expose a stable subscription hook for listener accounting",
      );

  metrics.cases.heap = client.support.heap
    ? await client.measureHeap()
    : unsupported("portable heap measurement is current-only in this harness");

  metrics.cases.navigation = unsupported(
    "real Phoenix navigation is excluded from the offline temp harness; only package-level lifecycle surfaces are measured here",
  );

  return metrics;
}

function unsupported(reason) {
  return Object.freeze({ supported: false, reason });
}

function createServerAdapter(target) {
  if (target.kind === "current") {
    const server = target.serverModule.createLiveViewReactServer({
      components: { Bench: { component: BenchComponentCurrent } },
    });
    return Object.freeze({
      render: (props, rootId = "bench") =>
        server.render({
          component: "Bench",
          events: {},
          identifierPrefix: currentIdentifierPrefix(rootId),
          props,
          slots: {},
          streams: {},
          version: 2,
        }),
    });
  }

  const render = target.serverModule.getRender({
    Bench: BenchComponentLegacy,
  });
  return Object.freeze({
    render: (props) => Promise.resolve(render("Bench", props, {})),
  });
}

async function createClientAdapter(target) {
  if (target.kind === "current") {
    const api = target.clientModule;
    globalThis.__benchCurrentApi = api;
    const live = api.createLiveViewReact({
      components: { Bench: { component: BenchComponentCurrent } },
    });
    const liveEvents = api.createLiveViewReact({
      components: {
        EventBench: { component: EventBenchCurrent },
        ListenerBench: { component: ListenerBenchCurrent },
      },
    });
    return Object.freeze({
      support: Object.freeze({
        eventBridge: true,
        heap: true,
        listenerBalance: true,
        streams: true,
      }),
      createHydrationFixture(server, props) {
        return createCurrentFixture({
          hook: live.hooks.LiveViewReactHook,
          html: null,
          hydration: true,
          props,
          server,
          componentName: "Bench",
        });
      },
      createMountFixture(props) {
        return createCurrentFixture({
          hook: live.hooks.LiveViewReactHook,
          hydration: false,
          props,
          componentName: "Bench",
        });
      },
      createStreamFixture() {
        return createCurrentStreamFixture(live.hooks.LiveViewReactHook);
      },
      async measureEventBridge() {
        return measureCase({
          ...DEFAULT_BENCHMARK_OPTIONS,
          batch: async () => {
            const fixture = createCurrentFixture({
              hook: liveEvents.hooks.LiveViewReactHook,
              hydration: false,
              props: {},
              componentName: "EventBench",
            });
            await fixture.mount();
            const button = fixture.host.el.querySelector("button");
            assertInvariant(
              button instanceof HTMLElement,
              "event bench must render a button",
            );
            await act(async () => {
              for (let index = 0; index < 200; index += 1) button.click();
            });
            await fixture.destroy();
          },
          iterationsPerSample: 200,
          name: "event-bridge-click",
        });
      },
      async measureListenerBalance() {
        const counts = { add: 0, remove: 0 };
        const result = await measureCase({
          ...DEFAULT_BENCHMARK_OPTIONS,
          batch: async () => {
            const fixture = createCurrentFixture({
              hook: liveEvents.hooks.LiveViewReactHook,
              hydration: false,
              props: {},
              componentName: "ListenerBench",
              overrides: {
                handleEvent(name, callback) {
                  counts.add += 1;
                  return { name, callback };
                },
                removeHandleEvent(name) {
                  if (name) counts.remove += 1;
                },
              },
            });
            await fixture.mount();
            await fixture.destroy();
          },
          iterationsPerSample: 1,
          name: "listener-balance",
        });
        return Object.freeze({
          ...result,
          registrations: counts.add,
          removals: counts.remove,
        });
      },
      async measureHeap() {
        const gc = globalThis.gc;
        if (typeof gc === "function") gc();
        const before =
          typeof gc === "function" ? process.memoryUsage().heapUsed : null;
        for (let index = 0; index < 200; index += 1) {
          const fixture = createCurrentFixture({
            hook: live.hooks.LiveViewReactHook,
            hydration: false,
            props: { value: index },
            componentName: "Bench",
          });
          await fixture.mount();
          await fixture.destroy();
        }
        if (typeof gc === "function") gc();
        const after =
          typeof gc === "function" ? process.memoryUsage().heapUsed : null;
        return Object.freeze({
          supported: true,
          heapDeltaBytes:
            before === null || after === null ? null : after - before,
          samples: 200,
        });
      },
    });
  }

  const hooks = target.clientModule.getHooks({
    Bench: BenchComponentLegacy,
    EventBench: EventBenchLegacy,
    ListenerBench: ListenerBenchLegacy,
  });
  return Object.freeze({
    support: Object.freeze({
      eventBridge: true,
      heap: true,
      listenerBalance: target.kind !== "legacy-npm",
      streams: target.kind === "legacy-main",
    }),
    createHydrationFixture(server, props) {
      return createLegacyFixture({
        componentName: "Bench",
        hook: hooks.ReactHook,
        hydration: true,
        props,
        server,
      });
    },
    createMountFixture(props) {
      return createLegacyFixture({
        componentName: "Bench",
        hook: hooks.ReactHook,
        hydration: false,
        props,
      });
    },
    createStreamFixture() {
      assertInvariant(
        target.kind === "legacy-main",
        "only upstream main supports stream fixture",
      );
      return createLegacyStreamFixture(hooks.ReactHook);
    },
    async measureEventBridge() {
      return measureCase({
        ...DEFAULT_BENCHMARK_OPTIONS,
        batch: async () => {
          const fixture = createLegacyFixture({
            componentName: "EventBench",
            hook: hooks.ReactHook,
            hydration: false,
            props: {},
          });
          await fixture.mount();
          const button = fixture.host.el.querySelector("button");
          assertInvariant(
            button instanceof HTMLElement,
            "legacy event bench must render a button",
          );
          await act(async () => {
            for (let index = 0; index < 200; index += 1) button.click();
          });
          await fixture.destroy();
        },
        iterationsPerSample: 200,
        name: "event-bridge-click",
      });
    },
    async measureListenerBalance() {
      const counts = { add: 0, remove: 0 };
      const result = await measureCase({
        ...DEFAULT_BENCHMARK_OPTIONS,
        batch: async () => {
          const fixture = createLegacyFixture({
            componentName: "ListenerBench",
            hook: hooks.ReactHook,
            hydration: false,
            props: {},
            overrides: {
              handleEvent(name) {
                counts.add += 1;
                return name;
              },
              removeHandleEvent(name) {
                if (name) counts.remove += 1;
              },
            },
          });
          await fixture.mount();
          await fixture.destroy();
        },
        iterationsPerSample: 1,
        name: "listener-balance",
      });
      return Object.freeze({
        ...result,
        registrations: counts.add,
        removals: counts.remove,
      });
    },
    async measureHeap() {
      const gc = globalThis.gc;
      if (typeof gc === "function") gc();
      const before =
        typeof gc === "function" ? process.memoryUsage().heapUsed : null;
      for (let index = 0; index < 200; index += 1) {
        const fixture = createLegacyFixture({
          componentName: "Bench",
          hook: hooks.ReactHook,
          hydration: false,
          props: { value: index },
        });
        await fixture.mount();
        await fixture.destroy();
      }
      if (typeof gc === "function") gc();
      const after =
        typeof gc === "function" ? process.memoryUsage().heapUsed : null;
      return Object.freeze({
        supported: true,
        heapDeltaBytes:
          before === null || after === null ? null : after - before,
        samples: 200,
      });
    },
  });
}

function createCurrentFixture({
  hook,
  props,
  hydration,
  server,
  componentName,
  overrides = {},
}) {
  const el = document.createElement("div");
  nextFixtureId += 1;
  el.id = `bench-${nextFixtureId}`;
  el.setAttribute("data-component", componentName);
  el.setAttribute("data-liveview-react-version", "2");
  el.setAttribute("data-events", "{}");
  el.setAttribute("data-props-kind", "snapshot");
  el.setAttribute("data-props", compactJson(props));
  el.setAttribute("data-slots", "{}");
  el.setAttribute("data-streams-kind", hydration ? "hydration" : "snapshot");
  el.setAttribute("data-streams-diff", "");
  const target = document.createElement("div");
  target.setAttribute("data-react-target", "");
  el.append(target);
  document.body.append(el);

  const host = Object.freeze({
    el,
    handleEvent: overrides.handleEvent ?? (() => undefined),
    js: () => ({ exec: () => undefined }),
    liveSocket: null,
    pushEvent: overrides.pushEvent ?? (() => Promise.resolve(undefined)),
    pushEventTo: () => Promise.resolve([]),
    removeHandleEvent: overrides.removeHandleEvent ?? (() => undefined),
    upload: () => undefined,
    uploadTo: () => undefined,
  });

  return Object.freeze({
    host,
    async mount() {
      if (hydration) {
        const html = await server.render(props, el.id);
        target.innerHTML = html;
        target.setAttribute(
          "data-react-hydration",
          JSON.stringify({
            component: componentName,
            events: {},
            identifierPrefix: currentIdentifierPrefix(el.id),
            props,
            slots: {},
            streams: {},
            version: 2,
          }),
        );
      }
      await act(async () => {
        hook.mounted.call(host);
      });
    },
    async update(nextProps) {
      el.setAttribute("data-props-kind", "snapshot");
      el.setAttribute("data-props", compactJson(nextProps));
      el.setAttribute("data-streams-kind", "patch");
      el.setAttribute("data-streams-diff", "");
      await act(async () => {
        hook.updated.call(host);
      });
    },
    async destroy() {
      await act(async () => {
        hook.destroyed.call(host);
      });
      el.remove();
    },
  });
}

function createCurrentStreamFixture(hook) {
  const fixture = createCurrentFixture({
    hook,
    componentName: "Bench",
    hydration: false,
    props: { value: 0 },
  });
  fixture.host.el.setAttribute(
    "data-streams-diff",
    encodePatch([
      {
        op: "stream",
        path: "/rows",
        value: { deletes: [], inserts: [], items: [], reset: false },
      },
    ]),
  );
  return Object.freeze({
    ...fixture,
    async update(offset) {
      fixture.host.el.setAttribute("data-props-kind", "patch");
      fixture.host.el.setAttribute("data-props-diff", "");
      fixture.host.el.setAttribute("data-streams-kind", "patch");
      fixture.host.el.setAttribute(
        "data-streams-diff",
        encodePatch([
          {
            op: "stream",
            path: "/rows",
            value: {
              deletes: [],
              inserts: Array.from({ length: 25 }, (_, index) => [
                `row-${offset + 24 - index}`,
                -1,
                null,
                false,
              ]),
              items: Array.from({ length: 25 }, (_, index) => ({
                __dom_id: `row-${offset + index}`,
                label: `row-${offset + index}`,
                version: 1,
              })),
              reset: false,
            },
          },
        ]),
      );
      await act(async () => {
        hook.updated.call(fixture.host);
      });
    },
  });
}

function createLegacyFixture({
  hook,
  props,
  hydration,
  server,
  componentName,
  overrides = {},
}) {
  const el = document.createElement("div");
  el.setAttribute("data-name", componentName);
  el.setAttribute("data-props", JSON.stringify(props));
  el.setAttribute("data-slots", JSON.stringify({}));
  document.body.append(el);
  const host = {
    ...hook,
    el,
    handleEvent: overrides.handleEvent ?? (() => undefined),
    pushEvent: overrides.pushEvent ?? (() => Promise.resolve(undefined)),
    pushEventTo: () => Promise.resolve([]),
    removeHandleEvent: overrides.removeHandleEvent ?? (() => undefined),
    upload: () => undefined,
    uploadTo: () => undefined,
  };

  return Object.freeze({
    host,
    async mount() {
      if (hydration) {
        el.setAttribute("data-ssr", "true");
        el.innerHTML = await server.render(props);
      }
      await act(async () => {
        hook.mounted.call(host);
      });
    },
    async update(nextProps) {
      el.setAttribute("data-props", JSON.stringify(nextProps));
      await act(async () => {
        hook.updated.call(host);
      });
    },
    async destroy() {
      await act(async () => {
        hook.destroyed.call(host);
        window.dispatchEvent(new CustomEvent("phx:page-loading-stop"));
      });
      el.remove();
    },
  });
}

function createLegacyStreamFixture(hook) {
  const el = document.createElement("div");
  el.setAttribute("data-name", "Bench");
  el.setAttribute("data-props", compactJsonLegacy({ value: 0 }));
  el.setAttribute("data-use-diff", "true");
  el.setAttribute("data-props-diff", "");
  el.setAttribute("data-slots", JSON.stringify({}));
  el.setAttribute("data-streams-diff", "");
  document.body.append(el);
  const host = {
    ...hook,
    el,
    handleEvent: () => undefined,
    pushEvent: () => Promise.resolve(undefined),
    pushEventTo: () => Promise.resolve([]),
    removeHandleEvent: () => undefined,
    upload: () => undefined,
    uploadTo: () => undefined,
  };

  return Object.freeze({
    host,
    async mount() {
      await act(async () => {
        hook.mounted.call(host);
      });
    },
    async update(offset) {
      el.setAttribute(
        "data-streams-diff",
        encodePatch(
          Array.from({ length: 25 }, (_, index) => ({
            op: "upsert",
            path: "/rows/-",
            value: {
              __dom_id: `row-${offset + index}`,
              label: `row-${offset + index}`,
              version: 1,
            },
          })),
        ),
      );
      await act(async () => {
        hook.updated.call(host);
      });
    },
    async destroy() {
      await act(async () => {
        hook.destroyed.call(host);
        window.dispatchEvent(new CustomEvent("phx:page-loading-stop"));
      });
      el.remove();
    },
  });
}

function BenchComponentLegacy({ value, rows = [] }) {
  return React.createElement(
    "section",
    null,
    React.createElement("output", null, String(value)),
    React.createElement("span", null, String(rows.length)),
  );
}

function BenchComponentCurrent({ value, rows = [] }) {
  return React.createElement(
    "section",
    null,
    React.createElement("output", null, String(value)),
    React.createElement("span", null, String(rows.length)),
  );
}

function EventBenchCurrent() {
  const { pushEvent } = globalThis.__benchCurrentApi.useLiveViewReact();
  return React.createElement("button", {
    onClick() {
      void pushEvent("bench", { ok: true });
    },
    type: "button",
  });
}

function EventBenchLegacy({ pushEvent }) {
  return React.createElement("button", {
    onClick() {
      void pushEvent("bench", { ok: true });
    },
    type: "button",
  });
}

function ListenerBenchCurrent() {
  globalThis.__benchCurrentApi.useLiveEvent("bench:event", () => undefined);
  const [mounted] = useState(true);
  useEffect(() => () => undefined, []);
  return React.createElement("output", null, String(mounted));
}

function ListenerBenchLegacy({ handleEvent, removeHandleEvent }) {
  useEffect(() => {
    handleEvent("bench:event", () => undefined);
    return () => {
      removeHandleEvent("bench:event");
    };
  }, [handleEvent, removeHandleEvent]);
  return React.createElement("output", null, "listener");
}

function compactJson(value) {
  return JSON.stringify(value)
    .replace(/~/gu, "~~")
    .replace(/\^/gu, "~^")
    .replace(/"/gu, "^");
}

function compactJsonLegacy(value) {
  return compactJson(value);
}

function encodePatch(operations) {
  return operations
    .map((entry) => {
      const operation = Array.isArray(entry)
        ? { op: entry[0], path: entry[1], value: entry[2] }
        : entry;
      const op =
        operation.op === "remove"
          ? "d"
          : operation.op === "replace"
            ? "r"
            : operation.op === "add"
              ? "a"
              : operation.op === "stream"
                ? "s"
                : operation.op === "limit"
                  ? "l"
                  : "u";
      const path = `${operation.path.length}:${operation.path}`;
      if (operation.op === "remove") return `${op}${path}`;
      const value = operation.value;
      if (value === null) return `${op}${path}z`;
      if (typeof value === "boolean")
        return `${op}${path}b${value ? "1" : "0"}`;
      if (typeof value === "number")
        return `${op}${path}n${String(value).length}:${value}`;
      if (typeof value === "string")
        return `${op}${path}s${value.length}:${value}`;
      const compact = compactJson(value);
      return `${op}${path}J${compact.length}:${compact}`;
    })
    .join("");
}

function renderMarkdown(payload) {
  const lines = [
    "# Upstream Comparison Benchmark",
    "",
    `- Benchmarked at: ${payload.benchmarkedAt}`,
    `- Node: ${payload.environment.node}`,
    `- Platform: ${payload.environment.platform}`,
    `- Warmup samples: ${payload.configuration.warmupSamples}`,
    `- Measured samples: ${payload.configuration.samples}`,
    "",
  ];

  for (const [targetId, target] of Object.entries(payload.results)) {
    lines.push(`## ${targetId}`);
    lines.push(
      `- Package size: ${target.package.packageSizeBytes} bytes; unpacked: ${target.package.unpackedSizeBytes ?? "n/a"}; files: ${target.package.fileCount ?? "n/a"}`,
    );
    lines.push(
      `- Client static module graph: ${target.package.clientModuleGraphBytes ?? "n/a"} bytes; files: ${target.package.clientModuleGraphFiles ?? "n/a"}; public entry: ${target.package.clientPublicEntry ?? "n/a"}`,
    );
    for (const [caseName, result] of Object.entries(target.cases)) {
      if (result.supported === false) {
        lines.push(`- ${caseName}: N/A (${result.reason})`);
        continue;
      }
      if ("heapDeltaBytes" in result) {
        lines.push(
          `- ${caseName}: heap delta ${result.heapDeltaBytes ?? "n/a"} bytes across ${result.samples} cycles`,
        );
        continue;
      }
      if ("registrations" in result) {
        lines.push(
          `- ${caseName}: ${result.summary.hz.toFixed(2)} hz, mean ${result.summary.meanMs.toFixed(4)} ms, registrations ${result.registrations}, removals ${result.removals}`,
        );
        continue;
      }
      lines.push(
        `- ${caseName}: ${result.summary.hz.toFixed(2)} hz, mean ${result.summary.meanMs.toFixed(4)} ms, stdev ${result.summary.standardDeviationMs.toFixed(4)} ms`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
