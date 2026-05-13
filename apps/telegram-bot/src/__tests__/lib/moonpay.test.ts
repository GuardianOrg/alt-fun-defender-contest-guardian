import { describe, it, expect } from "vitest";

import {
  buildMoonPayBuyUrl,
  resolveBuyHypeUrl,
} from "../../lib/moonpay.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const API_KEY = "pk_test_abc123";
const SECRET = "sk_test_secret-99";

/**
 * Pre-computed reference signature for the canonical query
 *   ?apiKey=pk_test_abc123&currencyCode=hype&walletAddress=0x1234…5678
 * signed with `SECRET` via HMAC-SHA256 / base64. Generated externally
 * with `openssl dgst -sha256 -hmac "$SECRET" -binary | base64` — this
 * keeps the test independent of the implementation under test (a
 * crypto.subtle reference would just retrace the same code path).
 */
const EXPECTED_SIGNATURE_HYPE =
  "FvbHoIJwL1j/oPsdt7IynaLawESBnEQopFZjQhwGBu0=";

describe("buildMoonPayBuyUrl", () => {
  it("builds a buy.moonpay.com URL with apiKey + currencyCode + walletAddress + signature", async () => {
    const url = await buildMoonPayBuyUrl({
      apiKey: API_KEY,
      secretKey: SECRET,
      walletAddress: WALLET,
      currencyCode: "hype",
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://buy.moonpay.com/");
    expect(parsed.searchParams.get("apiKey")).toBe(API_KEY);
    expect(parsed.searchParams.get("currencyCode")).toBe("hype");
    expect(parsed.searchParams.get("walletAddress")).toBe(WALLET);
    expect(parsed.searchParams.get("signature")).toBeTruthy();
  });

  it("appends an HMAC-SHA256(secret, query) base64 signature MoonPay can verify", async () => {
    const url = await buildMoonPayBuyUrl({
      apiKey: API_KEY,
      secretKey: SECRET,
      walletAddress: WALLET,
      currencyCode: "hype",
    });

    const parsed = new URL(url);
    // `URLSearchParams.get` automatically decodes the URL-encoded
    // signature back to its raw base64 form, so a direct equality
    // check against the externally-computed reference proves both
    // the HMAC algorithm and the on-wire encoding.
    expect(parsed.searchParams.get("signature")).toBe(
      EXPECTED_SIGNATURE_HYPE,
    );
  });

  it("includes baseCurrencyCode and baseCurrencyAmount when provided", async () => {
    const url = await buildMoonPayBuyUrl({
      apiKey: API_KEY,
      secretKey: SECRET,
      walletAddress: WALLET,
      currencyCode: "hype",
      baseCurrencyCode: "usd",
      baseCurrencyAmount: 100,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("baseCurrencyCode")).toBe("usd");
    expect(parsed.searchParams.get("baseCurrencyAmount")).toBe("100");
  });

});

describe("resolveBuyHypeUrl", () => {
  it("uses BUY_HYPE_URL verbatim when explicitly set", async () => {
    const url = await resolveBuyHypeUrl(
      { BUY_HYPE_URL: "https://override.example/funding" },
      WALLET,
    );
    expect(url).toBe("https://override.example/funding");
  });

  it("falls back to the Hyperliquid app when MoonPay isn't configured", async () => {
    const url = await resolveBuyHypeUrl({}, WALLET);
    expect(url).toBe("https://app.hyperliquid.xyz");
  });

  it("falls back when only one half of the MoonPay key pair is set", async () => {
    const apiOnly = await resolveBuyHypeUrl(
      { MOONPAY_API_KEY: API_KEY },
      WALLET,
    );
    const secretOnly = await resolveBuyHypeUrl(
      { MOONPAY_SECRET_KEY: SECRET },
      WALLET,
    );
    expect(apiOnly).toBe("https://app.hyperliquid.xyz");
    expect(secretOnly).toBe("https://app.hyperliquid.xyz");
  });

  it("builds a signed MoonPay URL when both keys are set", async () => {
    const url = await resolveBuyHypeUrl(
      {
        MOONPAY_API_KEY: API_KEY,
        MOONPAY_SECRET_KEY: SECRET,
      },
      WALLET,
    );
    const parsed = new URL(url);
    expect(parsed.host).toBe("buy.moonpay.com");
    expect(parsed.searchParams.get("walletAddress")).toBe(WALLET);
    expect(parsed.searchParams.get("currencyCode")).toBe("hype");
    expect(parsed.searchParams.get("signature")).toBeTruthy();
  });

  it("honours MOONPAY_CURRENCY_CODE override", async () => {
    const url = await resolveBuyHypeUrl(
      {
        MOONPAY_API_KEY: API_KEY,
        MOONPAY_SECRET_KEY: SECRET,
        MOONPAY_CURRENCY_CODE: "usdc_hyperliquid",
      },
      WALLET,
    );
    expect(new URL(url).searchParams.get("currencyCode")).toBe(
      "usdc_hyperliquid",
    );
  });

  it("prefers BUY_HYPE_URL over MoonPay when both are set", async () => {
    const url = await resolveBuyHypeUrl(
      {
        BUY_HYPE_URL: "https://override.example/funding",
        MOONPAY_API_KEY: API_KEY,
        MOONPAY_SECRET_KEY: SECRET,
      },
      WALLET,
    );
    expect(url).toBe("https://override.example/funding");
  });
});
