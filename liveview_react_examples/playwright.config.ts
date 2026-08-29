import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: path.join(exampleRoot, "e2e"),
  outputDir: path.join(repositoryRoot, "test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  ...(process.env.CI ? { retries: 2, workers: 1 } : { retries: 0 }),
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(repositoryRoot, "playwright-report"),
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4002",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --force",
      cwd: path.join(exampleRoot, "assets"),
      env: { LIVEVIEW_REACT_E2E: "true" },
      url: "http://127.0.0.1:4011/@vite/client",
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: "mix phx.server",
      cwd: exampleRoot,
      env: {
        LIVEVIEW_REACT_E2E: "true",
        MIX_ENV: "test",
        PHX_SERVER: "true",
      },
      url: "http://127.0.0.1:4002/e2e/lifecycle",
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
