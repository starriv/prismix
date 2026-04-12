import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/__tests__/unit/**/*.test.ts",
      "src/__tests__/integration/**/*.test.ts",
    ],
    // Integration tests share server state — run sequentially
    fileParallelism: false,
    testTimeout: 10_000, // WASM engines need warmup time
    env: {
      JWT_SECRET: "test-secret-for-vitest",
      ENCRYPTION_SALT: "test-salt-for-vitest",
    },
  },
});
