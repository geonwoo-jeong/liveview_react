import path from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

import react from "@vitejs/plugin-react";
import liveViewReact from "liveview_react/vite";

// https://vitejs.dev/config/
export default defineConfig(({ command, isSsrBuild }) => {
  const isDev = command !== "build";
  const rootDir = import.meta.dirname;

  return {
    define: {
      __LIVEVIEW_REACT_E2E__: JSON.stringify(
        process.env.LIVEVIEW_REACT_E2E === "true",
      ),
    },
    server: {
      port: 4011,
      host: "127.0.0.1",
      strictPort: true, // fail if port is already in use
    },
    base: isDev ? undefined : "/assets",
    publicDir: "static",
    plugins: [
      react(),
      liveViewReact({ entrypoint: "./js/server.js" }),
      tailwindcss(),
    ],
    ssr: {
      // The production Node renderer ships as one self-contained ESM bundle.
      noExternal: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "./react-components"),
      },
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      // these packages are loaded as file:../deps/<name> imports
      // so they're not optimized for development by vite by default
      // we want to enable it for better DX
      // more https://vitejs.dev/guide/dep-pre-bundling#monorepos-and-linked-dependencies
      include: [
        "liveview_react",
        "phoenix",
        "phoenix_html",
        "phoenix_live_view",
      ],
    },
    build: {
      commonjsOptions: { transformMixedEsModules: true },
      target: "es2020",
      outDir: "../priv/static/assets", // emit assets to priv/static/assets
      emptyOutDir: true,
      sourcemap: isDev, // enable source map in dev build
      manifest: false, // do not generate manifest.json
      rollupOptions: {
        input: {
          app: path.resolve(rootDir, "./js/app.js"),
        },
        output: {
          // remove hashes to match phoenix way of handling assets
          entryFileNames: isSsrBuild ? "[name].mjs" : "[name].js",
          chunkFileNames: isSsrBuild ? "[name].mjs" : "[name].js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  };
});
