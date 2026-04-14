import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.json",
      },
    }),
  ],
  resolve: {
    alias: {
      "@launchpad/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    include: ["src/__tests__/worker-*.test.ts"],
    testTimeout: 15_000,
  },
});
