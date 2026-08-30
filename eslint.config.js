import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const sourceFiles = Object.freeze([
  "liveview_react_examples/assets/**/*.{js,jsx}",
  "liveview_react_examples/e2e/support/**/*.{js,jsx}",
]);

export default [
  Object.freeze({
    ignores: [
      "dist/**",
      "node_modules/**",
      "liveview_react_examples/assets/node_modules/**",
      "liveview_react_examples/priv/static/**",
    ],
  }),
  eslint.configs.recommended,
  Object.freeze({
    files: [
      ".github/scripts/*.mjs",
      "eslint.config.js",
      "liveview_react_examples/assets/vite.config.js",
    ],
    languageOptions: Object.freeze({
      globals: globals.node,
      sourceType: "module",
    }),
  }),
  Object.freeze({
    files: sourceFiles,
    languageOptions: Object.freeze({
      globals: Object.freeze({
        ...globals.browser,
        ...globals.node,
        __LIVEVIEW_REACT_E2E__: "readonly",
      }),
      parserOptions: Object.freeze({
        ecmaFeatures: Object.freeze({ jsx: true }),
      }),
      sourceType: "module",
    }),
    plugins: reactHooks.configs.flat["recommended-latest"].plugins,
    rules: Object.freeze({
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "no-console": "error",
    }),
  }),
];
