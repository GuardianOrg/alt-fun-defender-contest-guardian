import { USDC_ADDRESS } from "@launchpad/shared";

const RELAY_HYPEREVM_BRIDGE = "https://relay.link/bridge/hyperevm" as const;

/** Relay deposit flow with USDC on HyperEVM as the receive currency. */
export const RELAY_BRIDGE_USDC_URL =
  `${RELAY_HYPEREVM_BRIDGE}?toCurrency=${USDC_ADDRESS.toLowerCase()}` as const;

/** Relay uses the zero-address sentinel for native HYPE gas. */
export const RELAY_BRIDGE_HYPE_URL =
  `${RELAY_HYPEREVM_BRIDGE}?toCurrency=0x0000000000000000000000000000000000000000` as const;

/** Open Relay links with the same new-tab security flags everywhere. */
export function openRelayBridge(url: typeof RELAY_BRIDGE_USDC_URL | typeof RELAY_BRIDGE_HYPE_URL): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
