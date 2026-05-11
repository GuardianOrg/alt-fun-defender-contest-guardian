/**
 * Hand-rolled runtime validators for `POST /api/v1/webhook/indexer` payloads.
 *
 * The webhook is the only path the indexer (a separate trust boundary) can
 * reach to fan out events to every connected WebSocket client. The admin key
 * gates *who* can broadcast — these validators gate *what shape* gets through.
 *
 * Without per-channel validation, a bug or compromised key in the indexer can
 * deliver malformed payloads to every client at once: blank charts (low),
 * cache poisoning, or stored XSS if any string field is ever rendered as HTML.
 *
 * No zod / external schema lib — the surface here is two events with handful
 * of string fields each, so plain type-narrowing is shorter and adds zero
 * dependencies. If a third event type ever needs the webhook, add a branch.
 *
 * Mirrors the producer side: `apps/indexer/src/broadcast.ts` (`WebhookEvent`)
 * and the shared `TradeBroadcast` shape in `@launchpad/shared`.
 */

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const DECIMAL_DIGITS = /^\d+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isHexAddress(v: unknown): v is string {
  return typeof v === "string" && HEX_ADDRESS.test(v);
}

function isDecimalString(v: unknown): v is string {
  return typeof v === "string" && DECIMAL_DIGITS.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validates the `trade` channel payload. Discriminated union — exactly one
 * of the two variants must be satisfied (presence of `usdcAmount` is the
 * discriminator, matching the consumer-side narrowing in
 * `apps/web/src/services/tradeFeed.ts`).
 */
function validateTrade(data: unknown): string | null {
  if (!isObject(data)) return "data must be an object";
  if (!isNonEmptyString(data.id)) return "data.id must be a non-empty string";
  if (!isHexAddress(data.tokenAddress)) {
    return "data.tokenAddress must be a 0x-prefixed 40-char hex address";
  }
  if (!isDecimalString(data.timestamp)) {
    return "data.timestamp must be a decimal string";
  }

  const hasUsdc = "usdcAmount" in data;
  const hasCurve = "curveSupply" in data;
  if (hasUsdc === hasCurve) {
    return "data must be either a trade-list or chart-state variant, not both / neither";
  }

  if (hasUsdc) {
    if (!isDecimalString(data.usdcAmount)) {
      return "data.usdcAmount must be a decimal string";
    }
    if (!isDecimalString(data.tokenAmount)) {
      return "data.tokenAmount must be a decimal string";
    }
    if (!isHexAddress(data.trader)) {
      return "data.trader must be a 0x-prefixed 40-char hex address";
    }
    if (typeof data.isBuy !== "boolean") {
      return "data.isBuy must be a boolean";
    }
    return null;
  }

  if (!isDecimalString(data.curveSupply)) {
    return "data.curveSupply must be a decimal string";
  }
  if (!isDecimalString(data.ltReserve)) {
    return "data.ltReserve must be a decimal string";
  }
  return null;
}

/**
 * Validates the `graduation` channel payload. Two phases (`graduating`,
 * `graduated`) — they share `tokenAddress` / `timestamp` but carry different
 * trailing fields. See `apps/indexer/src/bonding.ts` for the producer.
 */
function validateGraduation(data: unknown): string | null {
  if (!isObject(data)) return "data must be an object";
  if (!isHexAddress(data.tokenAddress)) {
    return "data.tokenAddress must be a 0x-prefixed 40-char hex address";
  }
  if (!isDecimalString(data.timestamp)) {
    return "data.timestamp must be a decimal string";
  }

  if (data.phase === "graduating") {
    if (!isDecimalString(data.tokensForLP)) {
      return "data.tokensForLP must be a decimal string";
    }
    if (!isDecimalString(data.ltFromPair)) {
      return "data.ltFromPair must be a decimal string";
    }
    if (!isDecimalString(data.lpBurned)) {
      return "data.lpBurned must be a decimal string";
    }
    if (!isDecimalString(data.unsoldBurned)) {
      return "data.unsoldBurned must be a decimal string";
    }
    return null;
  }

  if (data.phase === "graduated") {
    if (!isHexAddress(data.pairAddress)) {
      return "data.pairAddress must be a 0x-prefixed 40-char hex address";
    }
    if (!isDecimalString(data.liquidity)) {
      return "data.liquidity must be a decimal string";
    }
    if (!isDecimalString(data.tokensInLP)) {
      return "data.tokensInLP must be a decimal string";
    }
    if (!isDecimalString(data.lpBurned)) {
      return "data.lpBurned must be a decimal string";
    }
    if (!isDecimalString(data.unsoldBurned)) {
      return "data.unsoldBurned must be a decimal string";
    }
    return null;
  }

  return "data.phase must be 'graduating' or 'graduated'";
}

/**
 * Returns `null` if the webhook payload is valid for the given event, or a
 * human-readable error string otherwise. Currently `trade` and `graduation`
 * are the only events the indexer emits over the webhook — `newToken`,
 * `price`, and `stats` are broadcast directly by the API itself (see
 * `lib/token-registration.ts` and `websocket/lt-ticker.ts`) and never traverse
 * this trust boundary. If a future indexer change adds a new event, add a
 * matching branch here at the same time.
 */
export function validateWebhookPayload(
  event: string,
  data: unknown,
  tokenAddress: unknown,
): string | null {
  if (tokenAddress !== undefined && !isHexAddress(tokenAddress)) {
    return "tokenAddress must be a 0x-prefixed 40-char hex address";
  }
  switch (event) {
    case "trade":
      return validateTrade(data);
    case "graduation":
      return validateGraduation(data);
    default:
      return `Unsupported webhook event: ${event}`;
  }
}
