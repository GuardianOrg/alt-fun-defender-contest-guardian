#!/usr/bin/env node
/**
 * Toggle HyperEVM "big blocks" on/off for the deployer wallet.
 *
 * HyperEVM dispatches transactions into two block sizes:
 *   - Small blocks (~2M gas, ~1s)  — default
 *   - Big blocks   (~30M gas, ~60s) — required for contract deploys
 *
 * The choice is per-wallet and lives on the Hyperliquid L1 (NOT the EVM), so
 * you flip it by signing an EIP-712 L1 action (`evmUserModify`) and POSTing
 * it to https://api.hyperliquid.xyz/exchange. There is no on-EVM way to
 * change this — `cast send` cannot help.
 *
 * Status is read via the `eth_usingBigBlocks(address)` JSON-RPC custom
 * method on any HyperEVM RPC.
 *
 * Usage:
 *   node scripts/toggle-big-blocks.mjs <on|off|status>
 *
 * Reads `.env` from this package automatically:
 *   DEPLOYER_PRIVATE_KEY=0x...
 *   HYPEREVM_RPC_URL=...
 *
 * IMPORTANT: This uses Hyperliquid's L1 action signing scheme, not the
 * simpler "user-signed action" scheme. The action is msgpack-encoded,
 * keccak-hashed with the nonce, then wrapped in a phantom-`Agent` EIP-712
 * envelope before signing. See `sign_l1_action` in
 * `hyperliquid-python-sdk/hyperliquid/utils/signing.py`.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encode as msgpackEncode } from "@msgpack/msgpack";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const HL_API = "https://api.hyperliquid.xyz/exchange";
const RPC = process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const PK = process.env.DEPLOYER_PRIVATE_KEY;

if (!PK) {
  console.error("Missing DEPLOYER_PRIVATE_KEY (set in packages/contracts/.env or env).");
  process.exit(1);
}

const account = privateKeyToAccount(PK);
const cmd = (process.argv[2] || "status").toLowerCase();

async function readStatus() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_usingBigBlocks",
      params: [account.address],
      id: 1,
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`eth_usingBigBlocks: ${JSON.stringify(body.error)}`);
  return Boolean(body.result);
}

function actionHash(action, nonce) {
  // msgpack(action) || nonce_be8 || 0x00 (no vault) — no expires_after byte.
  const packed = msgpackEncode(action);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64BE(BigInt(nonce));
  const buf = Buffer.concat([Buffer.from(packed), nonceBuf, Buffer.from([0x00])]);
  return keccak256(buf);
}

async function setBigBlocks(enabled) {
  const nonce = Date.now();
  const action = { type: "evmUserModify", usingBigBlocks: enabled };

  const connectionId = actionHash(action, nonce);

  // Phantom Agent EIP-712 envelope. `source` = "a" on mainnet, "b" on testnet.
  const typedData = {
    domain: {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: { source: "a", connectionId },
  };

  const signatureHex = await account.signTypedData(typedData);
  const r = `0x${signatureHex.slice(2, 66)}`;
  const s = `0x${signatureHex.slice(66, 130)}`;
  const v = parseInt(signatureHex.slice(130, 132), 16);

  const payload = { action, nonce, signature: { r, s, v } };
  const res = await fetch(HL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (body.status !== "ok") {
    throw new Error(`evmUserModify failed: ${JSON.stringify(body)}`);
  }
  return body;
}

(async () => {
  console.log(`Wallet: ${account.address}`);
  if (cmd === "status") {
    const on = await readStatus();
    console.log(`Big blocks: ${on ? "ON" : "OFF"}`);
    return;
  }
  if (cmd !== "on" && cmd !== "off") {
    console.error("Usage: node scripts/toggle-big-blocks.mjs <on|off|status>");
    process.exit(1);
  }
  const before = await readStatus();
  console.log(`Big blocks before: ${before ? "ON" : "OFF"}`);
  if ((cmd === "on") === before) {
    console.log("Already in requested state — no-op.");
    return;
  }
  const target = cmd === "on";
  console.log(`Setting big blocks → ${target ? "ON" : "OFF"} ...`);
  const resp = await setBigBlocks(target);
  console.log("API response:", JSON.stringify(resp));

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const now = await readStatus();
    if (now === target) {
      console.log(`Confirmed big blocks: ${now ? "ON" : "OFF"}`);
      return;
    }
  }
  console.warn("Toggle did not appear in eth_usingBigBlocks within 15s — may still propagate.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
