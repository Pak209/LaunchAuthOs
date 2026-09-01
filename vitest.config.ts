import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: process.env.RUN_FIREBASE_INTEGRATION ? [] : ["tests/**/*.integration.test.ts"],
  },
});
