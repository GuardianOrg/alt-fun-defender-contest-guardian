import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // @privy-io/react-auth references optional Solana peer deps that are not
      // installed. Rolldown (Vite 8) treats missing optional peer-dep exports as
      // build errors unlike Rollup. Shimming them as empty modules is safe because
      // we only use EVM functionality from Privy.
      shimMissingExports: true,
    },
  },
});
