import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackFile {
  readonly path: string;
}

interface PackResult {
  readonly filename: string;
  readonly files: readonly PackFile[];
}

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "liveview-react-pack-"));
const consumerDirectory = join(temporaryRoot, "consumer");
const npmCache = join(temporaryRoot, "npm-cache");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
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
    "THIRD_PARTY_NOTICES.md",
    "UPSTREAM.md",
  ]) {
    if (!packedPaths.has(requiredPath)) {
      throw new Error(`Packed package is missing ${requiredPath}`);
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

  const smokeProgram = String.raw`
    const client = await import("liveview_react");
    const server = await import("liveview_react/server");
    const vite = await import("liveview_react/vite");

    if (typeof client.createLiveViewReact !== "function") {
      throw new Error("Root export is missing createLiveViewReact");
    }
    if (typeof client.useLiveReact !== "function") {
      throw new Error("Root export is missing useLiveReact");
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
      ["use", "Live", "View", "React"].join(""),
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
      typeof vite.liveViewReactPlugin !== "function"
    ) {
      throw new Error("Vite export is missing the plugin factory");
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
        useLiveReact,
        type ComponentRegistry,
        type LiveFormServerSnapshot,
        type LiveUploadConfig,
      } from "liveview_react";
      import { createLiveViewReactServer } from "liveview_react/server";
      import liveViewReactPlugin from "liveview_react/vite";

      const Counter = (_props: { readonly count: number }) => null;
      const components = {
        Counter: { component: Counter },
      } satisfies ComponentRegistry;
      const runtime = createLiveViewReact({ components });
      runtime.hooks.LiveViewReactHook.mounted;
      createLiveViewReactServer({ components }).render({
        component: "Counter",
        events: {},
        identifierPrefix: "liveview-react-package-smoke-",
        props: { count: 1 },
      });

      function HookConsumer() {
        const bridge = useLiveReact();
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
        useLiveEvent<{ readonly count: number }>("count", ({ count }) => count);
        useEventReply<{ readonly ok: boolean }>("save");
        useLiveConnection();
        useLiveNavigation();

        return <button phx-click="increment" phx-value-count={1} />;
      }

      liveViewReactPlugin();
      void HookConsumer;
      void Link;
      void useEventReply;
      void useLiveConnection;
      void useLiveEvent;
      void useLiveForm;
      void useLiveNavigation;
      void useLiveUpload;
      void useLiveReact;
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

  process.stdout.write(
    "Packed package runtime and type import smoke passed.\n",
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
