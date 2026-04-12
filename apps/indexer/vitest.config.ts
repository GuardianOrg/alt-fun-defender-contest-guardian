import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/generated": path.resolve(__dirname, "src/__tests__/mocks/ponder.ts"),
      "@launchpad/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
