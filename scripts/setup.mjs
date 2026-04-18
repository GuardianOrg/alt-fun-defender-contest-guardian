#!/usr/bin/env node
/**
 * First-time dev setup.
 *
 * - Copies every `*.example` env file to its runtime sibling iff the target
 *   doesn't already exist (idempotent; safe to re-run).
 * - Builds `@launchpad/shared` so downstream `@launchpad/shared` imports
 *   resolve on the first `npm run dev`.
 * - Reports which env files still contain `ASK_A_TEAMMATE` placeholders.
 *
 * Zero external deps: pure Node + npm.
 */

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ENV_PAIRS = [
  { example: "apps/web/.env.example", target: "apps/web/.env.local" },
  { example: "apps/api/.dev.vars.example", target: "apps/api/.dev.vars" },
  { example: "apps/indexer/.env.example", target: "apps/indexer/.env.local" },
  {
    example: "packages/contracts/.env.example",
    target: "packages/contracts/.env",
    optional: true,
  },
];

const PLACEHOLDER = "ASK_A_TEAMMATE";

const copied = [];
const alreadyExisted = [];
const needsSecrets = [];

for (const { example, target, optional } of ENV_PAIRS) {
  const examplePath = resolve(ROOT, example);
  const targetPath = resolve(ROOT, target);

  if (!existsSync(examplePath)) {
    if (!optional) {
      console.error(`  missing template: ${example}`);
    }
    continue;
  }

  if (existsSync(targetPath)) {
    alreadyExisted.push(target);
  } else {
    copyFileSync(examplePath, targetPath);
    copied.push(target);
  }

  const contents = readFileSync(targetPath, "utf8");
  if (contents.includes(PLACEHOLDER)) {
    const placeholderLines = contents
      .split("\n")
      .filter((l) => l.includes(PLACEHOLDER))
      .map((l) => l.split("=")[0].trim());
    needsSecrets.push({ file: target, keys: placeholderLines });
  }
}

console.log("\n== env files ==");
if (copied.length > 0) {
  console.log("  created:");
  for (const t of copied) console.log(`    + ${t}`);
}
if (alreadyExisted.length > 0) {
  console.log("  already present (left alone):");
  for (const t of alreadyExisted) console.log(`    · ${t}`);
}

console.log("\n== building @launchpad/shared ==");
const build = spawnSync(
  "npm",
  ["run", "build", "--workspace", "@launchpad/shared"],
  { cwd: ROOT, stdio: "inherit" },
);
if (build.status !== 0) {
  console.error("\n  shared build failed — see output above");
  process.exit(build.status ?? 1);
}

if (needsSecrets.length > 0) {
  console.log("\n== secrets still required ==");
  console.log("  The following env files contain ASK_A_TEAMMATE placeholders.");
  console.log("  Ask a teammate for the dev values and fill them in:");
  for (const { file, keys } of needsSecrets) {
    console.log(`\n  ${file}`);
    for (const key of keys) console.log(`    - ${key}`);
  }
  console.log("");
}

console.log("\nSetup complete. Next: `npm run dev`\n");
