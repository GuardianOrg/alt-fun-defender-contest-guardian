/**
 * Relay.link prefilled bridge URLs. Both target HyperEVM as the destination
 * chain; only `toCurrency` differs (USDC contract vs. the native-token
 * sentinel `0x000…0`).
 *
 * Centralised here so every bridge / get-gas affordance in the app — the
 * contextual TradePanel CTAs, the Manage Wallet tab on the profile page,
 * any future header-level bridge surface — points at the same prefilled
 * destination. Editing the destination chain or the receive-currency lookup
 * is then a one-line change.
 */

import { USDC_ADDRESS } from "@launchpad/shared";

const RELAY_HYPEREVM_BRIDGE = "https://relay.link/bridge/hyperevm" as const;

/** Relay deposit flow with USDC on HyperEVM as the receive currency. */
export const RELAY_BRIDGE_USDC_URL =
  `${RELAY_HYPEREVM_BRIDGE}?toCurrency=${USDC_ADDRESS.toLowerCase()}` as const;

/**
 * Relay deposit flow with native HYPE (gas) on HyperEVM as the receive
 * currency. Relay represents the native token via the canonical zero
 * address sentinel.
 */
export const RELAY_BRIDGE_HYPE_URL =
  `${RELAY_HYPEREVM_BRIDGE}?toCurrency=0x0000000000000000000000000000000000000000` as const;

/**
 * Convenience helper for the trade-panel / manage-wallet open-in-new-tab
 * pattern. Centralised so every relay-link click uses the same
 * `noopener,noreferrer` window features (security baseline) and the same
 * `_blank` target.
 */
export function openRelayBridge(url: typeof RELAY_BRIDGE_USDC_URL | typeof RELAY_BRIDGE_HYPE_URL): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
