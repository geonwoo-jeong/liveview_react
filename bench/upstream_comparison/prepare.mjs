import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  assertInvariant,
  copyWorkspaceSnapshot,
  directoryByteSize,
  directoryFileCount,
  ensureDirectory,
  ensureSymlink,
  exportGitTree,
  extractTarball,
  fileSize,
  nowIso,
  parseArgs,
  readJson,
  removeIfExists,
  resolveRealPath,
  run,
  safeWriteJson,
  sha256File,
} from "./shared.mjs";
import { DEFAULT_WORKSPACE, PREPARE_MANIFEST, TARGETS } from "./config.mjs";

const options = parseArgs(process.argv);
const repositoryRoot = process.cwd();
const workspace = path.resolve(options.workspace ?? DEFAULT_WORKSPACE);
const cacheRoot = ensureDirectory(path.join(workspace, "cache"));
const targetsRoot = ensureDirectory(path.join(workspace, "targets"));
const upstreamRepository = path.join(cacheRoot, "upstream-full");
const npmCacheRoot = ensureDirectory(path.join(cacheRoot, "npm"));

prepare().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function prepare() {
  assertInvariant(
    resolveRealPath(repositoryRoot) !== resolveRealPath(workspace),
    "workspace must not point at the shared repository root",
  );

  if (!options.offline) {
    if (!existsSync(upstreamRepository)) {
      run(
        "git",
        [
          "clone",
          "https://github.com/mrdotb/live_react.git",
          upstreamRepository,
        ],
        {
          capture: false,
        },
      );
    } else {
      run("git", ["-C", upstreamRepository, "fetch", "--tags", "origin"], {
        capture: false,
      });
    }

    const tarballPath = path.join(npmCacheRoot, TARGETS.npmRc020.tarballFile);
    removeIfExists(tarballPath);
    run(
      "npm",
      [
        "pack",
        "@mrdotb/live-react@0.2.0-rc-0",
        "--pack-destination",
        npmCacheRoot,
      ],
      { capture: false },
    );
    assertInvariant(
      existsSync(tarballPath),
      "npm tarball download must create the expected file",
    );
  } else {
    assertInvariant(
      existsSync(upstreamRepository),
      "offline prepare requires an existing upstream clone",
    );
    assertInvariant(
      existsSync(path.join(npmCacheRoot, TARGETS.npmRc020.tarballFile)),
      "offline prepare requires the cached npm tarball",
    );
  }

  const currentRoot = path.join(targetsRoot, TARGETS.current.id);
  copyWorkspaceSnapshot(repositoryRoot, currentRoot);
  ensureSymlink(
    path.join(currentRoot, "node_modules"),
    path.join(repositoryRoot, "node_modules"),
  );
  run("npm", ["run", "build"], { capture: false, cwd: currentRoot });
  const currentPack = createPackInfo(
    currentRoot,
    path.join(cacheRoot, "packed", TARGETS.current.id),
    "dist/index.js",
  );

  const upstreamMainRoot = path.join(targetsRoot, TARGETS.upstreamMain.id);
  exportGitTree(upstreamRepository, TARGETS.upstreamMain.ref, upstreamMainRoot);
  const upstreamMainPack = createPackInfo(
    upstreamMainRoot,
    path.join(cacheRoot, "packed", TARGETS.upstreamMain.id),
    "assets/js/live_react/index.mjs",
  );
  ensureSymlink(
    path.join(upstreamMainRoot, "node_modules"),
    path.join(repositoryRoot, "node_modules"),
  );
  materializeLegacyJsxModules(upstreamMainRoot);
  normalizeLegacyEsm(upstreamMainRoot);

  const hexRoot = path.join(targetsRoot, TARGETS.hexV110.id);
  exportGitTree(upstreamRepository, TARGETS.hexV110.ref, hexRoot);
  const hexPack = createPackInfo(
    hexRoot,
    path.join(cacheRoot, "packed", TARGETS.hexV110.id),
    "assets/js/live_react/index.mjs",
  );
  ensureSymlink(
    path.join(hexRoot, "node_modules"),
    path.join(repositoryRoot, "node_modules"),
  );
  materializeLegacyJsxModules(hexRoot);
  normalizeLegacyEsm(hexRoot);

  const npmRoot = path.join(targetsRoot, TARGETS.npmRc020.id);
  const npmTarballPath = path.join(npmCacheRoot, TARGETS.npmRc020.tarballFile);
  extractTarball(npmTarballPath, npmRoot);
  const unpackedPackageRoot = path.join(npmRoot, "package");
  assertInvariant(
    existsSync(unpackedPackageRoot),
    "npm package extraction must create a package directory",
  );
  const npmPack = createDownloadedPackInfo(
    npmTarballPath,
    unpackedPackageRoot,
    "assets/js/live_react/index.mjs",
  );
  ensureSymlink(
    path.join(npmRoot, "node_modules"),
    path.join(repositoryRoot, "node_modules"),
  );
  materializeLegacyJsxModules(npmRoot);
  normalizeLegacyEsm(npmRoot);

  const manifest = Object.freeze({
    preparedAt: nowIso(),
    repositoryRoot,
    workspace,
    targets: Object.freeze({
      [TARGETS.current.id]: Object.freeze({
        clientEntry: "dist/index.js",
        kind: "current",
        label: TARGETS.current.label,
        packageInfo: currentPack,
        rootDir: currentRoot,
        serverEntry: "dist/server.js",
      }),
      [TARGETS.upstreamMain.id]: Object.freeze({
        clientEntry: "assets/js/live_react/hooks.js",
        kind: "legacy-main",
        label: TARGETS.upstreamMain.label,
        packageInfo: upstreamMainPack,
        ref: TARGETS.upstreamMain.ref,
        rootDir: upstreamMainRoot,
        serverEntry: "assets/js/live_react/server.mjs",
      }),
      [TARGETS.hexV110.id]: Object.freeze({
        clientEntry: "assets/js/live_react/hooks.js",
        kind: "legacy-hex",
        label: TARGETS.hexV110.label,
        packageInfo: hexPack,
        ref: TARGETS.hexV110.ref,
        rootDir: hexRoot,
        serverEntry: "assets/js/live_react/server.mjs",
      }),
      [TARGETS.npmRc020.id]: Object.freeze({
        clientEntry: "package/assets/js/live_react/hooks.js",
        kind: "legacy-npm",
        label: TARGETS.npmRc020.label,
        packageInfo: npmPack,
        ref: TARGETS.npmRc020.ref,
        rootDir: npmRoot,
        serverEntry: "package/assets/js/live_react/server.mjs",
      }),
    }),
  });

  safeWriteJson(path.join(workspace, PREPARE_MANIFEST), manifest);
}

function createPackInfo(cwd, packDirectory, clientPublicEntry) {
  ensureDirectory(packDirectory);
  const manifest = readJson(path.join(cwd, "package.json"));
  const tarballName = `${manifest.name.replace(/^@/u, "").replace(/\//gu, "-")}-${manifest.version}.tgz`;
  const tarballPath = path.join(packDirectory, tarballName);
  const inspectDirectory = path.join(packDirectory, "inspect");

  removeIfExists(tarballPath);
  removeIfExists(inspectDirectory);
  run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDirectory],
    { capture: false, cwd },
  );
  assertInvariant(
    existsSync(tarballPath),
    `npm pack must create ${tarballName}`,
  );
  extractTarball(tarballPath, inspectDirectory);

  const packageDirectory = path.join(inspectDirectory, "package");
  assertInvariant(
    existsSync(packageDirectory),
    `extracted tarball must contain package/ for ${tarballName}`,
  );
  return createPackageInfo({
    clientPublicEntry,
    fileCount: directoryFileCount(packageDirectory),
    filename: tarballName,
    packageDirectory,
    packageSizeBytes: fileSize(tarballPath),
    tarballSha256: sha256File(tarballPath),
    unpackedSizeBytes: directoryByteSize(packageDirectory),
  });
}

function createDownloadedPackInfo(
  tarballPath,
  packageDirectory,
  clientPublicEntry,
) {
  return createPackageInfo({
    clientPublicEntry,
    fileCount: directoryFileCount(packageDirectory),
    filename: path.basename(tarballPath),
    packageDirectory,
    packageSizeBytes: fileSize(tarballPath),
    tarballSha256: sha256File(tarballPath),
    unpackedSizeBytes: directoryByteSize(packageDirectory),
  });
}

function createPackageInfo({
  clientPublicEntry,
  fileCount,
  filename,
  packageDirectory,
  packageSizeBytes,
  tarballSha256,
  unpackedSizeBytes,
}) {
  const clientGraph = measureStaticModuleGraph(
    packageDirectory,
    clientPublicEntry,
  );
  return Object.freeze({
    clientPublicEntry,
    clientModuleGraphBytes: clientGraph.bytes,
    clientModuleGraphFiles: clientGraph.files,
    fileCount,
    filename,
    packageSizeBytes,
    tarballSha256,
    unpackedSizeBytes,
  });
}

function measureStaticModuleGraph(packageDirectory, entrySpecifier) {
  const entryPath = path.resolve(packageDirectory, entrySpecifier);
  assertPathInside(packageDirectory, entryPath);
  assertInvariant(
    existsSync(entryPath) && statSync(entryPath).isFile(),
    `client public entry must exist: ${entrySpecifier}`,
  );

  const pending = [entryPath];
  const visited = new Set();
  let bytes = 0;

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    bytes += fileSize(filePath);

    const source = readFileSync(filePath, "utf8");
    for (const specifier of readStaticModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const dependencyPath = resolveStaticModuleSpecifier(filePath, specifier);
      assertPathInside(packageDirectory, dependencyPath);
      pending.push(dependencyPath);
    }
  }

  return Object.freeze({ bytes, files: visited.size });
}

function readStaticModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:[^"'();]*?\s+from\s*)?["']([^"']+)["']/gu,
    /\bexport\s+(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\})\s+from\s*["']([^"']+)["']/gsu,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function resolveStaticModuleSpecifier(importerPath, specifier) {
  const cleanSpecifier = specifier.replace(/[?#].*$/u, "");
  const unresolvedPath = path.resolve(
    path.dirname(importerPath),
    cleanSpecifier,
  );
  const candidates = path.extname(cleanSpecifier)
    ? [unresolvedPath]
    : [
        unresolvedPath,
        `${unresolvedPath}.js`,
        `${unresolvedPath}.mjs`,
        `${unresolvedPath}.jsx`,
        path.join(unresolvedPath, "index.js"),
        path.join(unresolvedPath, "index.mjs"),
        path.join(unresolvedPath, "index.jsx"),
      ];
  const resolvedPath = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  assertInvariant(
    resolvedPath !== undefined,
    `could not resolve static client import ${JSON.stringify(specifier)} from ${importerPath}`,
  );
  return resolvedPath;
}

function assertPathInside(rootDirectory, filePath) {
  const relative = path.relative(path.resolve(rootDirectory), filePath);
  assertInvariant(
    relative !== ".." && !relative.startsWith(`..${path.sep}`),
    `client module graph escaped its package: ${filePath}`,
  );
}

function normalizeLegacyEsm(rootDirectory) {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (packageJson.type !== "module") {
      writeFileSync(
        packageJsonPath,
        `${JSON.stringify({ ...packageJson, type: "module" }, null, 2)}\n`,
        "utf8",
      );
    }
  }

  const contextJsxPath = path.join(
    rootDirectory,
    "assets/js/live_react/context.jsx",
  );
  if (existsSync(contextJsxPath)) {
    const contextJsPath = contextJsxPath.replace(/\.jsx$/u, ".js");
    writeFileSync(
      contextJsPath,
      [
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
      ].join("\n"),
      "utf8",
    );
  }

  const stack = [rootDirectory];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!fullPath.endsWith(".js") && !fullPath.endsWith(".mjs")) continue;

      const source = readFileSync(fullPath, "utf8");
      const normalized = source.replaceAll(
        /((?:from|import)\s*["'])(\.{1,2}\/[^"'?#]+)(["'])/gu,
        (_match, prefix, specifier, suffix) => {
          if (path.extname(specifier)) return `${prefix}${specifier}${suffix}`;
          for (const extension of [".js", ".mjs", ".jsx", ".ts", ".tsx"]) {
            const candidatePath = path.join(
              path.dirname(fullPath),
              `${specifier}${extension}`,
            );
            if (existsSync(candidatePath)) {
              return `${prefix}${specifier}${extension}${suffix}`;
            }
          }
          return `${prefix}${specifier}${suffix}`;
        },
      );
      if (normalized !== source) writeFileSync(fullPath, normalized, "utf8");
    }
  }
}

function materializeLegacyJsxModules(rootDirectory) {
  const contextJsx = path.join(
    rootDirectory,
    "assets/js/live_react/context.jsx",
  );
  if (existsSync(contextJsx)) {
    writeFileSync(
      path.join(path.dirname(contextJsx), "context.js"),
      [
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
      ].join("\n"),
      "utf8",
    );
  }

  const linkJsx = path.join(rootDirectory, "assets/js/live_react/link.jsx");
  if (existsSync(linkJsx)) {
    writeFileSync(
      path.join(path.dirname(linkJsx), "link.js"),
      [
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
      ].join("\n"),
      "utf8",
    );
  }
}
