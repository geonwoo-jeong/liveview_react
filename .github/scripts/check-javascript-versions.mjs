import { createRequire } from "node:module";
import { join } from "node:path";

const [
  expectedReact,
  expectedReactTypes,
  expectedReactDOMTypes,
  expectedTypeScript,
  expectedVite,
] = process.argv.slice(2);

if (
  !expectedReact ||
  !expectedReactTypes ||
  !expectedReactDOMTypes ||
  !expectedTypeScript ||
  !expectedVite
) {
  throw new Error(
    "Usage: check-javascript-versions.mjs REACT REACT_TYPES REACT_DOM_TYPES TYPESCRIPT VITE",
  );
}

const require = createRequire(join(process.cwd(), "package.json"));
const expectedVersions = Object.freeze({
  react: expectedReact,
  "react-dom": expectedReact,
  "@types/react": expectedReactTypes,
  "@types/react-dom": expectedReactDOMTypes,
  typescript: expectedTypeScript,
  vite: expectedVite,
});

for (const [packageName, expectedVersion] of Object.entries(expectedVersions)) {
  const manifest = require(`${packageName}/package.json`);
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${packageName} resolved to ${manifest.version}; expected ${expectedVersion}`,
    );
  }
}

console.log(
  `Verified React ${expectedReact}, React types ${expectedReactTypes}/${expectedReactDOMTypes}, TypeScript ${expectedTypeScript}, and Vite ${expectedVite}.`,
);
