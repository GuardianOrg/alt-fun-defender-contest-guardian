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
    example: "apps/stress-test/.env.example",
    target: "apps/stress-test/.env.local",
    optional: true,
  },
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
const missingRequiredTemplates = [];

for (const { example, target, optional } of ENV_PAIRS) {
  const examplePath = resolve(ROOT, example);
  const targetPath = resolve(ROOT, target);

  if (!existsSync(examplePath)) {
    if (!optional) {
      missingRequiredTemplates.push(example);
    }
    continue;
  }

  if (existsSync(targetPath)) {
    alreadyExisted.push(target);
  } else {
    copyFileSync(examplePath, targetPath);
    copied.push(target);
  }

  // Only match KEY=value assignments whose *value* still contains the
  // placeholder. Comment lines and the instructional header mention the
  // placeholder string literally, so a plain `contents.includes` would keep
  // flagging files forever after they're filled in.
  const contents = readFileSync(targetPath, "utf8");
  const placeholderKeys = contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
    .filter((match) => match !== null && match[2].includes(PLACEHOLDER))
    .map((match) => match[1]);

  if (placeholderKeys.length > 0) {
    needsSecrets.push({ file: target, keys: placeholderKeys });
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

// Bail early if a required template is missing — continuing would silently
// leave the repo half-configured and Setup would still print a success
// message with exit 0.
if (missingRequiredTemplates.length > 0) {
  console.error("\n== ERROR: missing required templates ==");
  for (const t of missingRequiredTemplates) console.error(`    - ${t}`);
  console.error(
    "\n  These files should be committed to the repo. Check out a clean",
  );
  console.error(
    "  copy of the branch or restore them from git history before retrying.",
  );
  process.exit(1);
}

console.log("\n== building @launchpad/shared ==");
// On Windows, spawnSync can't resolve `npm` without the `.cmd` extension
// (unless shell: true, which brings its own quoting footguns). Explicit
// platform-aware binary name is the safer choice.
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(
  npmBin,
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
