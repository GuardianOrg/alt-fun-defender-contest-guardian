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

  it("falls back to the Relay onramp when BUY_USDC_URL is malformed or non-HTTPS", () => {
    // Garbage / partially-edited config values must never reach
    // Telegram's URL validator — that would reject the entire
    // /start reply and brick the funding CTA. HTTPS-only is the
    // floor for a money-related override; `http://` overrides
    // downgrade the funding CTA to plaintext and are rejected.
    const cases = [
      "",
      "  ",
      "not a url",
      "ftp://example.com/funding",
      "http://override.example/funding",
    ];
    for (const raw of cases) {
      const url = resolveBuyUsdcUrl({ BUY_USDC_URL: raw }, WALLET);
      const parsed = new URL(url);
      expect(parsed.host).toBe("relay.link");
      expect(parsed.searchParams.get("toAddress")).toBe(WALLET);
    }
  });

  it("accepts an HTTPS BUY_USDC_URL override and returns its normalized form", () => {
    expect(
      resolveBuyUsdcUrl(
        { BUY_USDC_URL: "https://override.example/funding?utm=tg" },
        WALLET,
      ),
    ).toBe("https://override.example/funding?utm=tg");
  });
});
