import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server/index.ts", "src/server/worker.ts"],
  outDir: "dist/server",
  format: "esm",
  target: "node20",
  platform: "node",
  // Bundle all internal src/ code into a single file.
  // Native/npm dependencies stay external (resolved from node_modules at runtime).
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Resolve @/* path alias so bundled output has no bare @/ specifiers
  esbuildOptions(options) {
    options.alias = { "@": "./src" };
  },
});
