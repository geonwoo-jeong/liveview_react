import { execFileSync } from "node:child_process";
import { deepStrictEqual } from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

interface PackFile {
  readonly path: string;
}

interface PackResult {
  readonly filename: string;
  readonly files: readonly PackFile[];
}

interface PackageManifest {
  readonly exports?: unknown;
  readonly main?: unknown;
  readonly name?: unknown;
  readonly private?: unknown;
  readonly sideEffects?: unknown;
  readonly type?: unknown;
  readonly types?: unknown;
  readonly version?: unknown;
}

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "liveview-react-pack-"));
const consumerDirectory = join(temporaryRoot, "consumer");
const npmCache = join(temporaryRoot, "npm-cache");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const expectedExportMap = Object.freeze({
  ".": Object.freeze({
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  }),
  "./server": Object.freeze({
    types: "./dist/server.d.ts",
    import: "./dist/server.js",
  }),
  "./vite": Object.freeze({
    types: "./dist/vite.d.ts",
    import: "./dist/vite.js",
  }),
});
const expectedPackageSurface = Object.freeze({
  exports: expectedExportMap,
  main: "./dist/index.js",
  name: "liveview_react",
  private: true,
  sideEffects: false,
  type: "module",
  types: "./dist/index.d.ts",
});
const publicEntryPoints = Object.freeze([
  "liveview_react",
  "liveview_react/server",
  "liveview_react/vite",
]);

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function linkProjectPackage(
  packageName: string,
  destinationNodeModules: string,
): void {
  const pathSegments = packageName.split("/");
  const source = join(projectRoot, "node_modules", ...pathSegments);
  const destination = join(destinationNodeModules, ...pathSegments);
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(source, destination, "junction");
}

function assertPeerPackageAbsent(
  packageName: string,
  nodeModulesDirectory: string,
): void {
  if (existsSync(join(nodeModulesDirectory, packageName))) {
    throw new Error(
      `${packageName} must not be available from ${nodeModulesDirectory}`,
    );
  }
}

function runFileLinkedPhoenixBuildSmoke(): void {
  const phoenixRoot = join(temporaryRoot, "phoenix-app");
  const phoenixDependencyRoot = join(phoenixRoot, "deps");
  const localPackageDirectory = join(phoenixDependencyRoot, "liveview_react");
  const assetsDirectory = join(phoenixRoot, "assets");
  const assetsNodeModules = join(assetsDirectory, "node_modules");
  const peerInaccessibleNodeModules = Object.freeze([
    join(localPackageDirectory, "node_modules"),
    join(phoenixDependencyRoot, "node_modules"),
    join(phoenixRoot, "node_modules"),
    join(temporaryRoot, "node_modules"),
  ]);

  mkdirSync(localPackageDirectory, { recursive: true });
  mkdirSync(assetsDirectory, { recursive: true });
  cpSync(
    join(projectRoot, "package.json"),
    join(localPackageDirectory, "package.json"),
  );
  cpSync(join(projectRoot, "dist"), join(localPackageDirectory, "dist"), {
    recursive: true,
  });
  writeJson(join(assetsDirectory, "package.json"), {
    name: "phoenix-assets-file-link-smoke",
    private: true,
    type: "module",
    dependencies: {
      liveview_react: "file:../deps/liveview_react",
    },
  });

  run(
    npmCommand,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      npmCache,
      "--legacy-peer-deps",
      "--omit=peer",
    ],
    assetsDirectory,
  );

  const installedPackageDirectory = join(assetsNodeModules, "liveview_react");
  deepStrictEqual(
    realpathSync(installedPackageDirectory),
    realpathSync(localPackageDirectory),
    "file: dependency did not link to the package copied into Phoenix deps",
  );

  for (const nodeModulesDirectory of peerInaccessibleNodeModules) {
    for (const peerPackage of ["react", "react-dom", "vite"]) {
      assertPeerPackageAbsent(peerPackage, nodeModulesDirectory);
    }
  }

  for (const packageName of [
    "@vitejs/plugin-react",
    "react",
    "react-dom",
    "vite",
  ]) {
    linkProjectPackage(packageName, assetsNodeModules);
  }

  mkdirSync(join(assetsDirectory, "js"), { recursive: true });
  mkdirSync(join(assetsDirectory, "react-components"), { recursive: true });
  writeFileSync(
    join(assetsDirectory, "react-components", "Counter.tsx"),
    String.raw`
      export interface CounterProps {
        readonly count: number;
      }

      export default function Counter({ count }: CounterProps) {
        return <button type="button">Count: {count}</button>;
      }
    `,
  );
  writeFileSync(
    join(assetsDirectory, "js", "liveview_react.ts"),
    String.raw`
      import components from "virtual:liveview-react/components";
      import { createLiveViewReact } from "liveview_react";

      export const liveViewReact = createLiveViewReact({ components });
    `,
  );
  writeFileSync(
    join(assetsDirectory, "js", "liveview_react_server.tsx"),
    String.raw`
      import components from "virtual:liveview-react/components";
      import { createLiveViewReactServer } from "liveview_react/server";
      import type { ServerRenderRequest } from "liveview_react/server";

      const server = createLiveViewReactServer({ components });

      export function render(request: ServerRenderRequest): Promise<string> {
        return server.render(request);
      }
    `,
  );
  writeFileSync(
    join(assetsDirectory, "vite.config.mjs"),
    String.raw`
      import react from "@vitejs/plugin-react";
      import { defineConfig } from "vite";
      import liveViewReactPlugin from "liveview_react/vite";

      export default defineConfig({
        plugins: [
          react(),
          liveViewReactPlugin({ entrypoint: "./js/liveview_react_server.tsx" }),
        ],
        resolve: {
          dedupe: ["react", "react-dom"],
        },
        build: {
          outDir: "../priv/static/assets",
          emptyOutDir: true,
          rollupOptions: {
            input: "./js/liveview_react.ts",
          },
        },
      });
    `,
  );
  writeFileSync(
    join(assetsDirectory, "vite.liveview-react.ssr.config.mjs"),
    String.raw`
      import react from "@vitejs/plugin-react";
      import { defineConfig } from "vite";
      import liveViewReactPlugin from "liveview_react/vite";

      export default defineConfig({
        plugins: [
          react(),
          liveViewReactPlugin({ entrypoint: "./js/liveview_react_server.tsx" }),
        ],
        resolve: {
          dedupe: ["react", "react-dom"],
        },
        ssr: {
          noExternal: true,
        },
        build: {
          ssr: "./js/liveview_react_server.tsx",
          outDir: "../priv/liveview_react",
          emptyOutDir: true,
          rollupOptions: {
            output: {
              entryFileNames: "server.mjs",
              chunkFileNames: "[name]-[hash].mjs",
            },
          },
        },
      });
    `,
  );

  const viteEntrypoint = join(projectRoot, "node_modules/vite/bin/vite.js");
  run(
    process.execPath,
    [viteEntrypoint, "build", "--config", "vite.config.mjs"],
    assetsDirectory,
  );
  run(
    process.execPath,
    [viteEntrypoint, "build", "--config", "vite.liveview-react.ssr.config.mjs"],
    assetsDirectory,
  );

  if (!existsSync(join(phoenixRoot, "priv", "liveview_react", "server.mjs"))) {
    throw new Error("File-linked Phoenix SSR build did not emit server.mjs");
  }
  for (const nodeModulesDirectory of peerInaccessibleNodeModules) {
    for (const peerPackage of ["react", "react-dom", "vite"]) {
      assertPeerPackageAbsent(peerPackage, nodeModulesDirectory);
    }
  }
}

function localMarkdownTargets(source: string): readonly string[] {
  return [...source.matchAll(/\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g)]
    .map((match) => match[1])
    .filter((target): target is string =>
      Boolean(
        target &&
        !target.startsWith("/") &&
        !target.includes(":") &&
        !target.startsWith("#"),
      ),
    )
    .map((target) => target.split("#", 1)[0] as string);
}

try {
  const packageManifest = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  ) as PackageManifest;
  deepStrictEqual(
    {
      exports: packageManifest.exports,
      main: packageManifest.main,
      name: packageManifest.name,
      private: packageManifest.private,
      sideEffects: packageManifest.sideEffects,
      type: packageManifest.type,
      types: packageManifest.types,
    },
    expectedPackageSurface,
  );

  const dryRunOutput = run(
    npmCommand,
    ["pack", "--dry-run", "--json", "--ignore-scripts", "--cache", npmCache],
    projectRoot,
  );
  const [dryRunResult] = JSON.parse(dryRunOutput) as PackResult[];
  if (!dryRunResult) {
    throw new Error("npm pack --dry-run did not return a package result");
  }

  const packOutput = run(
    npmCommand,
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      temporaryRoot,
      "--cache",
      npmCache,
    ],
    projectRoot,
  );
  const [packResult] = JSON.parse(packOutput) as PackResult[];
  if (!packResult) throw new Error("npm pack did not return a package result");

  const packedPaths = new Set(packResult.files.map((file) => file.path));
  deepStrictEqual(
    [...packedPaths].toSorted(),
    dryRunResult.files.map((file) => file.path).toSorted(),
    "npm pack dry-run and actual tarball file lists differ",
  );
  const forbiddenPackedPath = [...packedPaths].find(
    (path) =>
      path.startsWith("dist/tests/") ||
      path.endsWith(".map") ||
      path.includes(".bench.") ||
      path.includes(".test-support.") ||
      path.includes(".test."),
  );
  if (forbiddenPackedPath) {
    throw new Error(
      `Packed package contains a development-only artifact: ${forbiddenPackedPath}`,
    );
  }

  for (const requiredPath of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/react-phx.d.ts",
    "dist/server.js",
    "dist/server.d.ts",
    "dist/vite.js",
    "dist/vite.d.ts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE.md",
  ]) {
    if (!packedPaths.has(requiredPath)) {
      throw new Error(`Packed package is missing ${requiredPath}`);
    }
  }

  for (const markdownPath of [...packedPaths].filter((path) =>
    path.endsWith(".md"),
  )) {
    const source = readFileSync(join(projectRoot, markdownPath), "utf8");
    for (const target of localMarkdownTargets(source)) {
      const resolvedTarget = posix.normalize(
        posix.join(posix.dirname(markdownPath), target),
      );
      if (!packedPaths.has(resolvedTarget)) {
        throw new Error(
          `${markdownPath} links to ${target}, which is missing from the packed package`,
        );
      }
    }
  }

  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "package-smoke", private: true, type: "module" }, null, 2)}\n`,
  );

  const tarball = join(temporaryRoot, packResult.filename);
  run(
    npmCommand,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      npmCache,
      "--legacy-peer-deps",
      "--omit=peer",
      tarball,
    ],
    consumerDirectory,
  );
  const installedManifest = JSON.parse(
    readFileSync(
      join(consumerDirectory, "node_modules", "liveview_react", "package.json"),
      "utf8",
    ),
  ) as PackageManifest;
  deepStrictEqual(installedManifest, packageManifest);
  symlinkSync(
    join(projectRoot, "node_modules/react"),
    join(consumerDirectory, "node_modules/react"),
    "junction",
  );
  symlinkSync(
    join(projectRoot, "node_modules/react-dom"),
    join(consumerDirectory, "node_modules/react-dom"),
    "junction",
  );
  symlinkSync(
    join(projectRoot, "node_modules/@types"),
    join(consumerDirectory, "node_modules/@types"),
    "junction",
  );
  symlinkSync(
    join(projectRoot, "node_modules/vite"),
    join(consumerDirectory, "node_modules/vite"),
    "junction",
  );

  for (const entryPoint of publicEntryPoints) {
    const importProgram = String.raw`
      if ("window" in globalThis || "document" in globalThis) {
        throw new Error("Node import probe unexpectedly has browser globals");
      }
      await import(${JSON.stringify(entryPoint)});
    `;
    run(
      process.execPath,
      ["--input-type=module", "--eval", importProgram],
      consumerDirectory,
    );
  }

  const smokeProgram = String.raw`
    const client = await import("liveview_react");
    const server = await import("liveview_react/server");
    const vite = await import("liveview_react/vite");

    const assertExactExports = (name, module, expected) => {
      const actual = Object.keys(module).toSorted();
      const wanted = expected.toSorted();
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
        throw new Error(
          name + " exports " + JSON.stringify(actual) +
            "; expected " + JSON.stringify(wanted),
        );
      }
    };

    assertExactExports("Root entry point", client, [
      "Link",
      "LiveEventReplyCancelledError",
      "LiveEventReplyTimeoutError",
      "LiveFormSubmitCancelledError",
      "LiveFormSubmitInvalidError",
      "createLiveViewReact",
      "useEventReply",
      "useLiveConnection",
      "useLiveEvent",
      "useLiveForm",
      "useLiveNavigation",
      "useLiveViewReact",
      "useLiveUpload",
    ]);
    assertExactExports("Server entry point", server, [
      "createLiveViewReactServer",
    ]);
    assertExactExports("Vite entry point", vite, [
      "default",
      "liveViewReactPlugin",
    ]);

    if (typeof client.createLiveViewReact !== "function") {
      throw new Error("Root export is missing createLiveViewReact");
    }
    if (typeof client.useLiveViewReact !== "function") {
      throw new Error("Root export is missing useLiveViewReact");
    }
    if (typeof client.useLiveEvent !== "function") {
      throw new Error("Root export is missing useLiveEvent");
    }
    if (typeof client.useEventReply !== "function") {
      throw new Error("Root export is missing useEventReply");
    }
    if (typeof client.useLiveConnection !== "function") {
      throw new Error("Root export is missing useLiveConnection");
    }
    if (typeof client.useLiveNavigation !== "function") {
      throw new Error("Root export is missing useLiveNavigation");
    }
    if (typeof client.useLiveForm !== "function") {
      throw new Error("Root export is missing useLiveForm");
    }
    if (typeof client.useLiveUpload !== "function") {
      throw new Error("Root export is missing useLiveUpload");
    }
    if (typeof client.Link !== "function") {
      throw new Error("Root export is missing Link");
    }
    const removedRootExports = [
      ["get", "Hooks"].join(""),
      ["use", "Live", "React"].join(""),
    ];
    if (removedRootExports.some((name) => name in client)) {
      throw new Error("Root export still exposes a removed API");
    }
    if (typeof server.createLiveViewReactServer !== "function") {
      throw new Error("Server export is missing createLiveViewReactServer");
    }
    const removedServerExport = ["get", "Render"].join("");
    if (removedServerExport in server) {
      throw new Error("Server export still exposes a removed API");
    }
    if (
      typeof vite.default !== "function" ||
      typeof vite.liveViewReactPlugin !== "function" ||
      vite.default !== vite.liveViewReactPlugin
    ) {
      throw new Error("Vite default and named exports must be the same plugin factory");
    }

    let legacySubpathRejected = false;
    try {
      const removedSubpath = ["liveview_react/vite", "-", "plugin"].join("");
      await import(removedSubpath);
    } catch (error) {
      legacySubpathRejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
    }

    if (!legacySubpathRejected) {
      throw new Error("Removed Vite subpath is still importable");
    }
  `;
  run(
    process.execPath,
    ["--input-type=module", "--eval", smokeProgram],
    consumerDirectory,
  );

  writeFileSync(
    join(consumerDirectory, "consumer.tsx"),
    String.raw`
      import {
        createLiveViewReact,
        Link,
        useEventReply,
        useLiveConnection,
        useLiveEvent,
        useLiveForm,
        useLiveNavigation,
        useLiveUpload,
        useLiveViewReact,
        type ComponentProps,
        type ComponentRegistry,
        type ComponentRegistryEntry,
        type ConnectionSnapshot,
        type CreateLiveViewReactOptions,
        type EagerComponentEntry,
        type EventPayload,
        type HandleEvent,
        type LazyComponentEntry,
        type LazyComponentModule,
        type LinkProps,
        type LiveFormControl,
        type LiveFormControlChangeEvent,
        type LiveFormControlFocusEvent,
        type LiveFormControlValue,
        type LiveFormErrors,
        type LiveFormFieldBinding,
        type LiveFormFieldOptions,
        type LiveFormHiddenInputProps,
        type LiveFormInputProps,
        type LiveFormOptions,
        type LiveFormPath,
        type LiveFormPathSegment,
        type LiveFormProps,
        type LiveFormRequired,
        type LiveFormRevisionInputProps,
        type LiveFormServerSnapshot,
        type LiveFormSubmitEvent,
        type LiveFormValues,
        type LiveNavigation,
        type LiveNavigationOptions,
        type LiveUploadDropTargetProps,
        type LiveUploadConfig,
        type LiveUploadEntry,
        type LiveUploadError,
        type LiveUploadSelection,
        type LiveUploadSelectionStatus,
        type LiveViewReact,
        type LiveViewReactComponent,
        type LiveViewReactContextValue,
        type LiveViewReactHookDefinition,
        type LiveViewReactHooks,
        type LiveViewReactRootOptions,
        type LiveViewReactRootWrapper,
        type LiveViewReactRootWrapperContext,
        type LiveViewTarget,
        type PushEvent,
        type PushEventTo,
        type RemoveHandleEvent,
        type SlotMap,
        type StreamItem,
        type StreamMap,
        type TargetedEventReply,
        type Upload,
        type UploadFiles,
        type UploadTo,
        type UseEventReplyOptions,
        type UseEventReplyResult,
        type UseLiveFormResult,
        type UseLiveUploadOptions,
        type UseLiveUploadResult,
      } from "liveview_react";
      import {
        createLiveViewReactServer,
        type CreateLiveViewReactServerOptions,
        type LiveViewReactServer,
        type ServerRenderRequest,
      } from "liveview_react/server";
      import liveViewReactPlugin, {
        liveViewReactPlugin as namedLiveViewReactPlugin,
        type LiveViewReactPluginOptions,
      } from "liveview_react/vite";

      const Counter = (_props: { readonly count: number }) => null;
      const components = {
        Counter: { component: Counter },
      } satisfies ComponentRegistry;
      const runtime = createLiveViewReact({ components });
      runtime.hooks.LiveViewReactHook.mounted;
      const streams = {
        rows: [{ __dom_id: "rows-1", count: 1 }],
      } satisfies StreamMap;
      const row: StreamItem = streams.rows[0];
      void row;
      const rendered = await createLiveViewReactServer({ components }).render({
        component: "Counter",
        events: {},
        identifierPrefix: "liveview-react-package-smoke-",
        props: { count: 1 },
        slots: {},
        streams,
        version: 2,
      });
      if (typeof rendered !== "string") {
        throw new Error("Server render did not resolve to a string");
      }

      function HookConsumer() {
        const bridge = useLiveViewReact();
        const form = useLiveForm(
          {
            id: "profile-form",
            name: "profile",
            values: { email: "" },
            errors: {},
            required: { email: true },
            valid: true,
            revision: 0,
          } satisfies LiveFormServerSnapshot<{ readonly email: string }>,
          { changeEvent: "validate", submitEvent: "save" },
        );
        const upload = useLiveUpload({
          accept: "any",
          auto_upload: false,
          entries: [],
          errors: [],
          max_entries: 1,
          max_entries_mode: "selected",
          max_file_size: 8_000_000,
          name: "avatar",
          ref: "avatar-ref",
        } satisfies LiveUploadConfig);
        const reply: Promise<{ readonly ok: boolean }> =
          bridge.pushEvent<{ readonly ok: boolean }>("save", { count: 1 });
        void reply;
        void form;
        void upload;
        const submitEvent = {
          id: "profile-form",
          name: "profile",
          reply: { saved: true },
          revision: 0,
        } satisfies LiveFormSubmitEvent<{ readonly saved: boolean }>;
        void submitEvent;
        useLiveEvent<{ readonly count: number }>("count", ({ count }) => count);
        useEventReply<{ readonly ok: boolean }>("save");
        useLiveConnection();
        useLiveNavigation();

        return <button phx-click="increment" phx-value-count={1} />;
      }

      const viteOptions = {
        componentDirectory: "./react-components",
        entrypoint: "./js/server.ts",
        maxBodyBytes: 1_048_576,
        path: "/ssr_render",
      } satisfies Required<LiveViewReactPluginOptions>;
      liveViewReactPlugin(viteOptions);
      namedLiveViewReactPlugin(viteOptions);
      void HookConsumer;
      void Link;
      void useEventReply;
      void useLiveConnection;
      void useLiveEvent;
      void useLiveForm;
      void useLiveNavigation;
      void useLiveUpload;
      void useLiveViewReact;
    `,
  );
  writeFileSync(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          lib: ["ES2024", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2024",
          types: ["node"],
        },
        include: ["consumer.tsx"],
      },
      null,
      2,
    )}\n`,
  );
  run(
    process.execPath,
    [join(projectRoot, "node_modules/typescript/bin/tsc"), "-p", "."],
    consumerDirectory,
  );

  runFileLinkedPhoenixBuildSmoke();

  process.stdout.write(
    "Packed package runtime/type imports and file-linked Phoenix Vite builds passed.\n",
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
