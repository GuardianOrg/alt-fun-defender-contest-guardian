import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import type { UserConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    css: false,
  },
} as UserConfig);
