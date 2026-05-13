/**
 * Builders for the MoonPay buy-widget URL used by the `/start`
 * "Buy HYPE via Privy" button. Privy's hosted funding page is
 * SDK-only (no public deeplink — see
 * https://docs.privy.io/wallets/funding/overview), so the bot
 * deeplinks straight to MoonPay, which is the underlying onramp
 * Privy itself wraps for fiat. The end-to-end customer journey
 * (`apiKey + currencyCode + walletAddress + signature`) follows
 * https://dev.moonpay.com/docs/ramps-sdk-buy-params — every URL we
 * emit carries a signature because the `walletAddress` parameter is
 * pre-filled.
 */

const MOONPAY_BUY_BASE = "https://buy.moonpay.com";

export interface MoonPayBuyUrlInput {
  apiKey: string;
  secretKey: string;
  walletAddress: string;
  currencyCode: string;
  baseCurrencyCode?: string;
  baseCurrencyAmount?: number;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/**
 * HMAC-SHA256 of `message` with `secret`, base64-encoded. MoonPay's
 * signing spec calls for the digest itself (not hex) — the signature
 * goes onto the URL through `encodeURIComponent`, so `+` and `/` in
 * the base64 digest survive transit.
 */
const hmacSha256Base64 = async (
  secret: string,
  message: string,
): Promise<string> => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64(new Uint8Array(digest));
};

/**
 * Build a signed `https://buy.moonpay.com/` buy-widget URL. Returns
 * a string ready to drop into a Telegram inline-keyboard `url`
 * button. The signature is appended last per MoonPay's spec.
 *
 * Why `URLSearchParams` for the query but a manual `signature` tail:
 * the signed message must be byte-identical to the query string the
 * browser ultimately presents to MoonPay. `URLSearchParams.toString()`
 * is the canonical serializer, so we sign its output and then append
 * the signature with the same encoder.
 */
export const buildMoonPayBuyUrl = async (
  input: MoonPayBuyUrlInput,
): Promise<string> => {
  const params = new URLSearchParams();
  params.set("apiKey", input.apiKey);
  params.set("currencyCode", input.currencyCode);
  params.set("walletAddress", input.walletAddress);
  if (input.baseCurrencyCode) {
    params.set("baseCurrencyCode", input.baseCurrencyCode);
  }
  if (input.baseCurrencyAmount !== undefined) {
    params.set("baseCurrencyAmount", String(input.baseCurrencyAmount));
  }
  const query = `?${params.toString()}`;
  const signature = await hmacSha256Base64(input.secretKey, query);
  return `${MOONPAY_BUY_BASE}/${query}&signature=${encodeURIComponent(signature)}`;
};

export interface ResolveBuyHypeUrlEnv {
  BUY_HYPE_URL?: string;
  MOONPAY_API_KEY?: string;
  MOONPAY_SECRET_KEY?: string;
  MOONPAY_CURRENCY_CODE?: string;
}

/**
 * Default onramp fallback when MoonPay isn't configured. Hyperliquid's
 * app embeds swapped.com's fiat widget inside its deposit modal —
 * good enough as a v0 escape hatch, and the historical default of
 * this button before MoonPay wiring landed.
 */
const HYPERLIQUID_APP_URL = "https://app.hyperliquid.xyz";

const DEFAULT_MOONPAY_CURRENCY_CODE = "hype";

/**
 * Resolve the URL the "Buy HYPE via Privy" button should point at.
 * Resolution order is explicit so a bad MoonPay config can be hot-
 * patched with `BUY_HYPE_URL` without redeploying:
 *
 * 1. `BUY_HYPE_URL` set → return as-is.
 * 2. MoonPay api+secret set → signed MoonPay URL with the user's
 *    custodial wallet pre-filled.
 * 3. Otherwise → Hyperliquid app (swapped.com fiat onramp).
 */
export const resolveBuyHypeUrl = async (
  env: ResolveBuyHypeUrlEnv,
  walletAddress: string,
): Promise<string> => {
  if (env.BUY_HYPE_URL) return env.BUY_HYPE_URL;
  if (env.MOONPAY_API_KEY && env.MOONPAY_SECRET_KEY) {
    return buildMoonPayBuyUrl({
      apiKey: env.MOONPAY_API_KEY,
      secretKey: env.MOONPAY_SECRET_KEY,
      walletAddress,
      currencyCode:
        env.MOONPAY_CURRENCY_CODE ?? DEFAULT_MOONPAY_CURRENCY_CODE,
    });
  }
  return HYPERLIQUID_APP_URL;
};
