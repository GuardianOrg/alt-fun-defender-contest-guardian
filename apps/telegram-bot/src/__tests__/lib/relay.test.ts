import { describe, it, expect } from "vitest";

import { USDC_ADDRESS } from "@launchpad/shared";

import {
  buildRelayOnrampUrl,
  resolveBuyUsdcUrl,
} from "../../lib/relay.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";

describe("buildRelayOnrampUrl", () => {
  it("targets the HyperEVM onramp slug with the destination wallet pre-filled", () => {
    const url = buildRelayOnrampUrl({ walletAddress: WALLET });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://relay.link/onramp/hyperevm",
    );
    expect(parsed.searchParams.get("toAddress")).toBe(WALLET);
  });

  it("defaults toCurrency to HyperEVM USDC from @launchpad/shared", () => {
    const url = buildRelayOnrampUrl({ walletAddress: WALLET });
    expect(new URL(url).searchParams.get("toCurrency")).toBe(USDC_ADDRESS);
  });

  it("locks destination token and chain so the deposit cannot be re-routed in the widget", () => {
    const url = buildRelayOnrampUrl({ walletAddress: WALLET });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("lockToken")).toBe("true");
    expect(parsed.searchParams.get("lockToChain")).toBe("true");
  });

  it("honours an explicit toCurrency override", () => {
    const url = buildRelayOnrampUrl({
      walletAddress: WALLET,
      toCurrency: "0x0000000000000000000000000000000000000001",
    });
    expect(new URL(url).searchParams.get("toCurrency")).toBe(
      "0x0000000000000000000000000000000000000001",
    );
  });
});

describe("resolveBuyUsdcUrl", () => {
  it("uses BUY_USDC_URL verbatim when explicitly set", () => {
    const url = resolveBuyUsdcUrl(
      { BUY_USDC_URL: "https://override.example/funding" },
      WALLET,
    );
    expect(url).toBe("https://override.example/funding");
  });

  it("falls through to the Relay onramp when BUY_USDC_URL is unset", () => {
    const url = resolveBuyUsdcUrl({}, WALLET);
    const parsed = new URL(url);
    expect(parsed.host).toBe("relay.link");
    expect(parsed.pathname).toBe("/onramp/hyperevm");
    expect(parsed.searchParams.get("toCurrency")).toBe(USDC_ADDRESS);
    expect(parsed.searchParams.get("toAddress")).toBe(WALLET);
  });
});
