import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Payment transactions only. No customer namespace or historical tests run here.
export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: {
    environment: "node",
    include: ["tests/firestore-fulfillment.integration.test.ts"],
    testNamePattern: /customer refunds|Checkout events|paid Checkout event|terminal checkout retries|settlement racing retry|payment reconciliation hold/,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
