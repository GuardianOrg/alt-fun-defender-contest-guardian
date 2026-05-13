import { initWasm, Resvg } from "@resvg/resvg-wasm";

// Wrangler bundles the `.wasm` file and exposes it as a
// `WebAssembly.Module` at import time — the only init path that works
// inside Cloudflare Workers (no `fetch`-of-a-URL allowed at module
// scope, no Node fs). Kept in its own file because vitest's default
// node env can't resolve this import and would crash any test that
// transitively pulled `chart.ts`. The renderer in `chart.ts` reaches
// this file via a dynamic `import("./chart-wasm.js")` so tests stay
// isolated.
// @ts-expect-error -- wrangler treats `.wasm` imports as WebAssembly.Module
import wasmModule from "@resvg/resvg-wasm/index_bg.wasm";

let initPromise: Promise<void> | null = null;

const ensureInited = async (): Promise<void> => {
  if (!initPromise) {
    initPromise = initWasm(wasmModule as WebAssembly.Module).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
};

export const svgToPng = async (svg: string): Promise<Uint8Array> => {
  await ensureInited();
  const resvg = new Resvg(svg);
  return resvg.render().asPng();
};
