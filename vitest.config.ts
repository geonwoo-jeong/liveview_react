import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "jsdom",
    include: ["assets/js/liveview_react/**/*.test.{ts,tsx}"],
  },
});
