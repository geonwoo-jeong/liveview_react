import { lstatSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const COMPONENTS_VIRTUAL_MODULE_ID = "virtual:liveview-react/components";
export const RESOLVED_COMPONENTS_VIRTUAL_MODULE_ID = `\0${COMPONENTS_VIRTUAL_MODULE_ID}`;

const COMPONENT_SOURCE_PATTERN = /\.(?:js|jsx|ts|tsx)$/;
const DECLARATION_PATTERN = /\.d\.(?:ts|tsx)$/;
const TEST_PATTERN = /\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9_$][A-Za-z0-9_$-]*$/;
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

interface ComponentFile {
  readonly absolutePath: string;
  readonly componentName: string;
  readonly relativePath: string;
}

export interface GeneratedComponentRegistry {
  readonly code: string;
  readonly files: readonly string[];
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isInside(parentDirectory: string, candidate: string): boolean {
  const pathFromParent = relative(parentDirectory, candidate);
  return (
    pathFromParent === "" ||
    (!isAbsolute(pathFromParent) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`))
  );
}

export function resolveComponentDirectory(
  viteRoot: string,
  configuredDirectory: string,
): string {
  const resolvedRoot = resolve(viteRoot);
  const resolvedDirectory = resolve(resolvedRoot, configuredDirectory);

  if (!isInside(resolvedRoot, resolvedDirectory)) {
    throw new TypeError(
      `componentDirectory must stay within the Vite root; received ${JSON.stringify(configuredDirectory)}`,
    );
  }

  const pathFromRoot = relative(resolvedRoot, resolvedDirectory);
  let currentPath = resolvedRoot;
  for (const segment of pathFromRoot.split(sep).filter(Boolean)) {
    currentPath = resolve(currentPath, segment);

    let metadata;
    try {
      metadata = lstatSync(currentPath);
    } catch (error: unknown) {
      if (isMissingFileError(error)) break;
      throw error;
    }

    if (metadata.isSymbolicLink()) {
      throw new TypeError(
        `componentDirectory must not traverse symbolic links; received ${JSON.stringify(configuredDirectory)}`,
      );
    }
    if (!metadata.isDirectory()) {
      throw new TypeError("componentDirectory must resolve to a directory");
    }
  }

  return resolvedDirectory;
}

function componentNameFromPath(relativePath: string): string {
  return relativePath.replace(COMPONENT_SOURCE_PATTERN, "");
}

function assertSafeComponentName(
  componentName: string,
  relativePath: string,
): void {
  for (const segment of componentName.split("/")) {
    if (RESERVED_SEGMENTS.has(segment)) {
      throw new TypeError(
        `Component name ${JSON.stringify(componentName)} from ${JSON.stringify(relativePath)} contains reserved segment ${JSON.stringify(segment)}`,
      );
    }

    if (!SAFE_SEGMENT_PATTERN.test(segment)) {
      throw new TypeError(
        `Component name ${JSON.stringify(componentName)} from ${JSON.stringify(relativePath)} contains unsafe segment ${JSON.stringify(segment)}`,
      );
    }
  }
}

function isComponentSource(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const fileName = segments.at(-1) ?? "";

  return (
    segments.every((segment) => !segment.startsWith(".")) &&
    COMPONENT_SOURCE_PATTERN.test(fileName) &&
    !DECLARATION_PATTERN.test(fileName) &&
    !TEST_PATTERN.test(fileName)
  );
}

export function isPotentialComponentFile(
  componentDirectory: string,
  file: string,
): boolean {
  const absoluteFile = resolve(file);
  if (!isInside(componentDirectory, absoluteFile)) return false;

  const relativePath = toPosixPath(relative(componentDirectory, absoluteFile));
  return relativePath !== "" && isComponentSource(relativePath);
}

async function collectComponentFiles(
  componentDirectory: string,
  currentDirectory: string,
): Promise<readonly ComponentFile[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const sortedEntries = entries.toSorted((left, right) =>
    compareStrings(left.name, right.name),
  );
  const files: ComponentFile[] = [];

  for (const entry of sortedEntries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;

    const absolutePath = resolve(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await collectComponentFiles(componentDirectory, absolutePath)),
      );
      continue;
    }

    if (!entry.isFile()) continue;

    const relativePath = toPosixPath(
      relative(componentDirectory, absolutePath),
    );
    if (!isComponentSource(relativePath)) continue;

    const componentName = componentNameFromPath(relativePath);
    assertSafeComponentName(componentName, relativePath);
    files.push({ absolutePath, componentName, relativePath });
  }

  return files;
}

async function discoverComponentFiles(
  componentDirectory: string,
): Promise<readonly ComponentFile[]> {
  let directoryMetadata;
  try {
    directoryMetadata = await lstat(componentDirectory);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  if (directoryMetadata.isSymbolicLink()) {
    throw new TypeError("componentDirectory must not be a symbolic link");
  }
  if (!directoryMetadata.isDirectory()) {
    throw new TypeError("componentDirectory must resolve to a directory");
  }

  const files = (
    await collectComponentFiles(componentDirectory, componentDirectory)
  ).toSorted((left, right) =>
    compareStrings(left.relativePath, right.relativePath),
  );
  const firstFileByName = new Map<string, ComponentFile>();

  for (const file of files) {
    const firstFile = firstFileByName.get(file.componentName);
    if (firstFile) {
      throw new TypeError(
        `Duplicate component name ${JSON.stringify(file.componentName)} from ${JSON.stringify(firstFile.relativePath)} and ${JSON.stringify(file.relativePath)}`,
      );
    }
    firstFileByName.set(file.componentName, file);
  }

  return files;
}

function generateRegistrySource(files: readonly ComponentFile[]): string {
  const imports = files.map(
    (file, index) =>
      `import LiveViewReactComponent${index} from ${JSON.stringify(toPosixPath(file.absolutePath))};`,
  );
  const entries = files.map(
    (file, index) =>
      `  ${JSON.stringify(file.componentName)}: Object.freeze({ component: LiveViewReactComponent${index} }),`,
  );

  return [
    ...imports,
    ...(imports.length > 0 ? [""] : []),
    "const components = Object.freeze({",
    ...entries,
    "});",
    "",
    "export default components;",
    "",
  ].join("\n");
}

export async function generateComponentRegistry(
  componentDirectory: string,
): Promise<GeneratedComponentRegistry> {
  const files = await discoverComponentFiles(componentDirectory);

  return Object.freeze({
    code: generateRegistrySource(files),
    files: Object.freeze(files.map((file) => file.absolutePath)),
  });
}
