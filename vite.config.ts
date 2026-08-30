import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const source = (file: string) =>
  fileURLToPath(new URL(`./assets/js/liveview_react/${file}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: {
        index: source("index.ts"),
        server: source("server.tsx"),
        vite: source("vite.ts"),
      },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ["es"],
    },
    minify: false,
    rollupOptions: {
      external: [
        /^node:/,
        /^react(?:\/.*)?$/,
        /^react-dom(?:\/.*)?$/,
        /^vite(?:\/.*)?$/,
      ],
    },
    sourcemap: false,
    target: "es2024",
  },
});
