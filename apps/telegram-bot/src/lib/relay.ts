import { USDC_ADDRESS } from "@launchpad/shared";

/**
 * Builder for the Relay onramp URL used by the `/start` "Buy USDC
 * via Relay" button. Relay aggregates fiat onramps + cross-chain
 * bridging in one widget and is the only path today that delivers
 * USDC directly onto HyperEVM (MoonPay has no HyperEVM listing;
 * Privy's hosted funding page is SDK-only — see
 * https://docs.privy.io/wallets/funding/overview — so neither can
 * be deeplinked from a Telegram URL button).
 *
 * Canonical URL shape (from the in-product widget):
 *
 *   https://relay.link/onramp/hyperevm
 *     ?toCurrency=<USDC contract on HyperEVM>
 *     &toAddress=<recipient wallet>
 *     &lockToken=true&lockToChain=true
 *
 * `lockToken` / `lockToChain` keep the user from accidentally
 * routing the deposit to a different chain/token — the bot wallet
 * only knows how to trade USDC on HyperEVM.
 */

const RELAY_ONRAMP_BASE = "https://relay.link/onramp/hyperevm";

export interface RelayOnrampUrlInput {
  walletAddress: string;
  /**
   * Token contract address on the destination chain. Defaults to
   * HyperEVM USDC. The whole bot trades in USDC, so this is the
   * only sensible destination — exposed as an arg purely for tests.
   */
  toCurrency?: string;
}

export const buildRelayOnrampUrl = (input: RelayOnrampUrlInput): string => {
  const params = new URLSearchParams();
  params.set("toCurrency", input.toCurrency ?? USDC_ADDRESS);
  params.set("toAddress", input.walletAddress);
  params.set("lockToken", "true");
  params.set("lockToChain", "true");
  return `${RELAY_ONRAMP_BASE}?${params.toString()}`;
};

export interface ResolveBuyUsdcUrlEnv {
  BUY_USDC_URL?: string;
}

/**
 * Validate that a raw env string is a well-formed http(s) URL. Ops
 * can paste a typo, a half-edited secret, or an internal hostname
 * here — handing that straight to Telegram as an inline-keyboard
 * `url` field would either reject the entire reply (Telegram's URL
 * validator is strict) or silently land users on a phishing-shaped
 * deeplink. Falling back to the Relay default keeps the button
 * usable instead of breaking `/start` outright.
 */
const isValidHttpUrl = (raw: string): boolean => {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * Resolve the URL the "Buy USDC via Relay" button should point at.
 * The optional `BUY_USDC_URL` env var lets ops hot-patch the link
 * (e.g. to a campaign-tracking variant or an alternative onramp)
 * without redeploying — but only if it parses as an http(s) URL.
 * An empty or malformed value silently falls back to the built
 * Relay deeplink with the user's custodial wallet pre-filled, so
 * the funding CTA never disappears on a config typo.
 */
export const resolveBuyUsdcUrl = (
  env: ResolveBuyUsdcUrlEnv,
  walletAddress: string,
): string => {
  if (env.BUY_USDC_URL && isValidHttpUrl(env.BUY_USDC_URL)) {
    return env.BUY_USDC_URL;
  }
  return buildRelayOnrampUrl({ walletAddress });
};
