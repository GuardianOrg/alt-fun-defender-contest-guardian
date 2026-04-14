/**
 * ink@4 requires react@^18 but npm hoists react@19 (from apps/web) to
 * the root, ignoring the override for nesting.  This script copies a
 * react@18 build into ink's own node_modules so it resolves correctly.
 *
 * Cross-platform (Node ≥ 16.7 for cpSync), runs as postinstall.
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readMajor(dir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
    return parseInt(pkg.version, 10);
  } catch {
    return undefined;
  }
}

const INK_NM = resolve("node_modules", "ink", "node_modules");
const TARGET = resolve(INK_NM, "react");

if (existsSync(TARGET) && readMajor(TARGET) === 18) process.exit(0);

const sources = [
  resolve("apps", "indexer", "node_modules", "react"),
  resolve("node_modules", "@ponder", "core", "node_modules", "react"),
];

const src = sources.find((s) => existsSync(s) && readMajor(s) === 18);

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
