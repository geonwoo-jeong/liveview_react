import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  generateComponentRegistry,
  isPotentialComponentFile,
  resolveComponentDirectory,
} from "./component-registry";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `liveview-react-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(root: string, path: string): Promise<string> {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "export default function Component() {}\n");
  return absolutePath;
}

function posixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Vite component registry generation", () => {
  it("discovers nested components deterministically and emits eager tagged entries", async () => {
    const root = await temporaryDirectory("nested");
    const componentDirectory = join(root, "react-components");
    const zed = await writeFixture(componentDirectory, "Zed.js");
    const userCard = await writeFixture(
      componentDirectory,
      "Admin/UserCard.tsx",
    );
    const alpha = await writeFixture(componentDirectory, "Alpha.jsx");

    const registry = await generateComponentRegistry(componentDirectory);

    expect(registry.files).toEqual([userCard, alpha, zed]);
    expect(registry.code).toBe(
      [
        `import LiveViewReactComponent0 from ${JSON.stringify(posixPath(userCard))};`,
        `import LiveViewReactComponent1 from ${JSON.stringify(posixPath(alpha))};`,
        `import LiveViewReactComponent2 from ${JSON.stringify(posixPath(zed))};`,
        "",
        "const components = Object.freeze({",
        '  "Admin/UserCard": Object.freeze({ component: LiveViewReactComponent0 }),',
        '  "Alpha": Object.freeze({ component: LiveViewReactComponent1 }),',
        '  "Zed": Object.freeze({ component: LiveViewReactComponent2 }),',
        "});",
        "",
        "export default components;",
        "",
      ].join("\n"),
    );
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.files)).toBe(true);
  });

  it("excludes declarations, tests, specs, dot paths, non-sources, and symlinks", async () => {
    const root = await temporaryDirectory("exclusions");
    const external = await temporaryDirectory("external");
    const componentDirectory = join(root, "react-components");
    const visible = await writeFixture(componentDirectory, "Visible.ts");
    await writeFixture(componentDirectory, "Visible.d.ts");
    await writeFixture(componentDirectory, "Unit.test.tsx");
    await writeFixture(componentDirectory, "Integration.spec.jsx");
    await writeFixture(componentDirectory, ".Hidden.tsx");
    await writeFixture(componentDirectory, ".private/Nested.tsx");
    await writeFixture(componentDirectory, "notes.txt");
    const externalFile = await writeFixture(external, "External.tsx");
    await symlink(externalFile, join(componentDirectory, "Linked.tsx"));
    await symlink(external, join(componentDirectory, "LinkedDirectory"));

    const registry = await generateComponentRegistry(componentDirectory);

    expect(registry.files).toEqual([visible]);
    expect(registry.code).toContain('"Visible": Object.freeze({ component:');
    expect(registry.code).not.toContain("Hidden");
    expect(registry.code).not.toContain("Linked");
    expect(registry.code).not.toContain("Unit");
  });

  it("rejects deterministic extension collisions", async () => {
    const root = await temporaryDirectory("collision");
    const componentDirectory = join(root, "react-components");
    await writeFixture(componentDirectory, "Button.js");
    await writeFixture(componentDirectory, "Button.tsx");

    await expect(generateComponentRegistry(componentDirectory)).rejects.toThrow(
      'Duplicate component name "Button" from "Button.js" and "Button.tsx"',
    );
  });

  it.each([
    [
      "constructor.tsx",
      'Component name "constructor" from "constructor.tsx" contains reserved segment "constructor"',
    ],
    [
      "Admin/__proto__.tsx",
      'Component name "Admin/__proto__" from "Admin/__proto__.tsx" contains reserved segment "__proto__"',
    ],
    [
      "Bad Name.tsx",
      'Component name "Bad Name" from "Bad Name.tsx" contains unsafe segment "Bad Name"',
    ],
  ])("rejects reserved or unsafe component path %s", async (path, message) => {
    const root = await temporaryDirectory("unsafe");
    const componentDirectory = join(root, "react-components");
    await writeFixture(componentDirectory, path);

    await expect(generateComponentRegistry(componentDirectory)).rejects.toThrow(
      message,
    );
  });

  it("rejects a symbolic-link component root and ignores nested links", async () => {
    const root = await temporaryDirectory("root-link");
    const target = await temporaryDirectory("root-link-target");
    const linkedDirectory = join(root, "react-components");
    await symlink(target, linkedDirectory);

    await expect(generateComponentRegistry(linkedDirectory)).rejects.toThrow(
      "componentDirectory must not be a symbolic link",
    );
  });

  it("returns an immutable empty registry when the directory does not exist", async () => {
    const root = await temporaryDirectory("missing");

    await expect(
      generateComponentRegistry(join(root, "react-components")),
    ).resolves.toEqual({
      code: [
        "const components = Object.freeze({",
        "});",
        "",
        "export default components;",
        "",
      ].join("\n"),
      files: [],
    });
  });

  it("resolves component directories inside the Vite root and rejects escapes", async () => {
    const root = await temporaryDirectory("containment");

    expect(resolveComponentDirectory(root, "./react-components")).toBe(
      join(root, "react-components"),
    );
    expect(() => resolveComponentDirectory(root, "../outside")).toThrow(
      'componentDirectory must stay within the Vite root; received "../outside"',
    );
  });

  it("rejects a component directory that traverses a symbolic link", async () => {
    const root = await temporaryDirectory("containment-link");
    const external = await temporaryDirectory("containment-link-target");
    await mkdir(join(external, "components"));
    await symlink(external, join(root, "linked"));

    expect(() => resolveComponentDirectory(root, "linked/components")).toThrow(
      'componentDirectory must not traverse symbolic links; received "linked/components"',
    );
  });

  it("classifies only eligible files below the component directory for watching", async () => {
    const root = await temporaryDirectory("watch-paths");
    const componentDirectory = join(root, "react-components");

    expect(
      isPotentialComponentFile(
        componentDirectory,
        join(componentDirectory, "Admin/Card.tsx"),
      ),
    ).toBe(true);
    expect(
      isPotentialComponentFile(
        componentDirectory,
        join(componentDirectory, "Card.test.tsx"),
      ),
    ).toBe(false);
    expect(
      isPotentialComponentFile(componentDirectory, join(root, "Outside.tsx")),
    ).toBe(false);
  });
});
