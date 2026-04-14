/**
 * ink@4 requires react@^18 but npm hoists react@19 (from apps/web) to
 * the root, ignoring the override for nesting.  This script copies a
 * react@18 build into ink's own node_modules so it resolves correctly.
 *
 * Cross-platform (Node ≥ 16.7 for cpSync), runs as postinstall.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const INK_NM = resolve("node_modules", "ink", "node_modules");
const TARGET = resolve(INK_NM, "react");

if (existsSync(TARGET)) process.exit(0);

const sources = [
  resolve("apps", "indexer", "node_modules", "react"),
  resolve("node_modules", "@ponder", "core", "node_modules", "react"),
];

const src = sources.find((s) => {
  try {
    const pkg = resolve(s, "package.json");
    if (!existsSync(pkg)) return false;
    // dynamic import not needed — just check the file exists
    return true;
  } catch {
    return false;
  }
});

if (!src) {
  console.warn("fix-ink-react: no react@18 source found — skipping");
  process.exit(0);
}

try {
  mkdirSync(INK_NM, { recursive: true });
  cpSync(src, TARGET, { recursive: true });
} catch (err) {
  console.warn(`fix-ink-react: copy failed — ${err.message}`);
}
