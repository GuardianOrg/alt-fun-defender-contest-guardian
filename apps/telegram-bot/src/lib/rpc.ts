import type { Env } from "./types.js";

/**
 * Public HyperEVM RPC fallback. Used when `HYPEREVM_RPC_URL` is unset
 * (smoke deploys, local dev). Production should provision the same
 * Alchemy endpoint as `apps/api` for consistent rate limits — see
 * AGENTS.md "Infrastructure".
 */
const DEFAULT_RPC_URL = "https://rpc.hyperliquid.xyz/evm";

/**
 * Hard ceiling on a single RPC call. Telegram retries the webhook
 * aggressively when the handler doesn't ACK quickly, so a stalled RPC
 * must surface as `null` ("Balance unavailable" in the UI) rather
 * than blocking the whole update. 3s is well above p99 for a live
 * eth_getBalance and well below Telegram's webhook timeout.
 */
const RPC_TIMEOUT_MS = 3000;

/** USDC on HyperEVM. See AGENTS.md "Contract Addresses". */
export const USDC_CONTRACT = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";

/** ERC-20 `balanceOf(address)` function selector. */
const BALANCE_OF_SELECTOR = "0x70a08231";

/**
 * `IBounceLeveragedToken.baseAssetBalance()` function selector. Returns
 * the LT's idle USDC buffer available for atomic `redeem()` — see
 * `packages/contracts/src/interfaces/IBounceLeveragedToken.sol`. Used by
 * /sell's buffer preflight: when a sell's expected USDC out exceeds this,
 * the on-chain `redeem` reverts with `InsufficientBalance` and we cap
 * the sell instead per AGENTS.md "BounceTech LT Integration →
 * Buffer-limited sells".
 */
const BASE_ASSET_BALANCE_SELECTOR = "0x1bc865d6";

interface JsonRpcResponse {
  result?: string;
  error?: { code: number; message: string };
}

/**
 * Read a wallet's native HYPE balance via `eth_getBalance`. Returns
 * `null` on any failure (network, non-2xx, malformed body, JSON-RPC
 * error) so the caller can render a clean "—" instead of crashing the
 * webhook. AGENTS.md "Error Handling" requires HYPE balance reads to
 * go through `rpc.ts`; this is the v1 single-call shape — multicall
 * lands when `/wallet` needs simultaneous HYPE + USDC + token reads.
 */
export const fetchNativeBalance = async (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
  address: string,
): Promise<bigint | null> => {
  const url = env.HYPEREVM_RPC_URL ?? DEFAULT_RPC_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
  } catch {
    // AbortError from the timeout lands here too — same fallback as
    // network errors. Caller renders "—" either way.
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  let body: JsonRpcResponse;
  try {
    body = (await res.json()) as JsonRpcResponse;
  } catch {
    return null;
  }
  if (body.error || typeof body.result !== "string") return null;
  try {
    return BigInt(body.result);
  } catch {
    return null;
  }
};

/**
 * Read an ERC-20 token balance via `eth_call` → `balanceOf(walletAddress)`.
 * Returns `null` on any network/RPC failure so callers render "—" cleanly.
 */
export const fetchErc20Balance = async (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
  tokenAddress: string,
  walletAddress: string,
): Promise<bigint | null> => {
  const url = env.HYPEREVM_RPC_URL ?? DEFAULT_RPC_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  const data =
    BALANCE_OF_SELECTOR + walletAddress.slice(2).toLowerCase().padStart(64, "0");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: tokenAddress, data }, "latest"],
      }),
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  let body: JsonRpcResponse;
  try {
    body = (await res.json()) as JsonRpcResponse;
  } catch {
    return null;
  }
  if (body.error || typeof body.result !== "string") return null;
  const hex = body.result;
  if (hex === "0x" || hex === "0x0") return 0n;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
};

/** Read the caller's USDC (6-decimal) balance on HyperEVM. */
export const fetchUsdcBalance = async (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
  walletAddress: string,
): Promise<bigint | null> =>
  fetchErc20Balance(env, USDC_CONTRACT, walletAddress);

/**
 * Read a BounceTech Leveraged Token's idle USDC buffer via
 * `baseAssetBalance()`. The on-chain `redeem()` consumes USDC from this
 * buffer at trade time — a sell whose expected USDC out exceeds the
 * buffer reverts with `InsufficientBalance`. Used as the /sell preflight
 * cap per AGENTS.md "BounceTech LT Integration → Buffer-limited sells".
 *
 * Returns `null` on any RPC failure so the caller can skip the preflight
 * and fall back to the post-tx revert path (matching every other
 * RPC helper in this module — preflight is a UX improvement, not a
 * correctness gate, so a transient RPC blip must not block valid sells).
 */
export const fetchLtBaseAssetBalance = async (
  env: Pick<Env, "HYPEREVM_RPC_URL">,
  ltAddress: string,
): Promise<bigint | null> => {
  const url = env.HYPEREVM_RPC_URL ?? DEFAULT_RPC_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: ltAddress, data: BASE_ASSET_BALANCE_SELECTOR }, "latest"],
      }),
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;
  let body: JsonRpcResponse;
  try {
    body = (await res.json()) as JsonRpcResponse;
  } catch {
    return null;
  }
  if (body.error || typeof body.result !== "string") return null;
  const hex = body.result;
  if (hex === "0x" || hex === "0x0") return 0n;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
};
