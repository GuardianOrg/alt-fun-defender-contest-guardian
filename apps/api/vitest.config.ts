import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@launchpad/shared": path.resolve(__dirname, "../../packages/shared/src"),
      // Cross-package: integration tests in src/__tests__/integration/ import the
      // indexer's handler module directly to prove the full event → indexed row →
      // API response loop without mocking the indexer. The aliases mirror the ones
      // in apps/indexer/vitest.config.ts so the handler resolves `ponder:registry`
      // to the same in-memory mock used by the indexer's own unit tests, and
      // `ponder:schema` to the real schema definition.
      "ponder:registry": path.resolve(
        __dirname,
        "../indexer/test/mocks/ponder.ts",
      ),
      "ponder:schema": path.resolve(__dirname, "../indexer/ponder.schema.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    exclude: ["node_modules"],
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
