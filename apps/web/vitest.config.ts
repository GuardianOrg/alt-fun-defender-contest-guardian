import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**"],
    env: {
      VITE_API_URL: "http://localhost:8787",
      VITE_PONDER_URL: "http://localhost:42069",
    },
  },
});
