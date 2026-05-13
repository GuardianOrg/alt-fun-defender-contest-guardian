import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight `.env` loader. We don't pull in `dotenv` to keep the install
 * surface minimal — the file format we accept is a strict subset:
 * `KEY=value` lines, `#` comments, optional surrounding quotes on values.
 * Anything more elaborate (multi-line, variable expansion) is intentionally
 * unsupported so values that look ambiguous round-trip as written.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");

// Only `.env.local` is read.
//
// This matches the rest of the repo (`apps/web/.env.local`,
// `apps/indexer/.env.local` — see `scripts/setup.mjs`) and dodges the
// classic two-file footgun where the "which file wins?" order has to
// be memorised. `.env.example` documents the schema and is committed;
// `.env.local` holds the actual values and is gitignored.
loadEnvFile(resolve(APP_ROOT, ".env.local"));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * Normalise a private key to viem's expected `0x`-prefixed shape. Mirrors
 * `normalizePrivateKey` in `apps/api/src/lib/auto-graduation-buyer.ts` —
 * some clipboard / secret-store tools strip the prefix on copy/paste and
 * viem's `privateKeyToAccount` only accepts the prefixed form.
 */
function normalizePrivateKey(raw: string): `0x${string}` {
  const cleaned = raw.trim();
  return (cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`) as `0x${string}`;
}

export interface AppConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  apiBaseUrl: string;
  apiKey: string | null;
}

export function loadConfig(): AppConfig {
  const privateKey = normalizePrivateKey(required("STRESS_TEST_PRIVATE_KEY"));
  const rpcUrl = optional("HYPEREVM_RPC_URL", "https://rpc.hyperliquid.xyz/evm");
  const apiBaseUrl = optional("API_BASE_URL", "http://localhost:8787").replace(
    /\/+$/,
    "",
  );
  const apiKey = process.env.STRESS_TEST_API_KEY?.trim() || null;
  return { privateKey, rpcUrl, apiBaseUrl, apiKey };
}
