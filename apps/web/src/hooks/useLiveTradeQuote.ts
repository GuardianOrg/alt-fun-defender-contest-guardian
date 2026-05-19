import { useCallback, useEffect, useRef, useState } from "react";

import { useLeveragedToken } from "./useLeveragedTokens";
import { createTradeFeedInvalidator } from "./useTokenLiveFeed";
import { tradeRouterService } from "../services/tradeRouter";
import { getWebSocketClient } from "../services/websocket";

import type { BuyQuote, SellQuote } from "../services/tradeRouter";
import type { Token } from "../services/types";

/**
 * Parse a wei-scaled decimal string into a positive `bigint`. Returns
 * `undefined` for anything we wouldn't trust as an LT rate / buffer
 * value — empty / non-numeric / zero / negative. The directory writes
 * `exchangeRate` and `baseAssetBalance` as `NUMERIC(78,0)` text, so a
 * malformed read (DB column drift, schema mismatch, stale cache) lands
 * here and we'd rather degrade to the on-chain RPC fallback inside
 * `tradeRouter` than poison the quote with a zero/garbage value.
 */
function parseLtAmount(raw: string | undefined): bigint | undefined {
  if (!raw) return undefined;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Debounce on user-driven re-quotes (typing into the amount input, mode
 *  toggles, slippage edits). Matches the previous inline behaviour in
 *  `TradePanel`. Long enough to coalesce a paste / fast-typed digit run
 *  into a single RPC quote, short enough to feel instant.
 */
const USER_INPUT_DEBOUNCE_MS = 300;

/**
 * Throttle on WS-driven re-quotes (trade ticks for this token, price ticks
 * for the backing LT). Same window the trade-panel's sibling surfaces use:
 *
 *   - `useTokenLiveFeed` (`INVALIDATE_THROTTLE_MS = 1_000`) coalesces
 *     `trade` channel hits before invalidating the `["token", :addr]`
 *     query that drives mcap / price / 24h on the rest of the page.
 *   - `useChartData` consumes the same `trade` + `price` channels at WS
 *     cadence, but the chart aggregator merges into the in-progress
 *     candle cheaply — the trade panel can't do that, every refresh is a
 *     batched on-chain read against the pair / LT, so we throttle.
 *
 * 1 s lines up with the LtTicker DO's price cadence and the API edge
 * cache window for `/tokens/:addr` — going faster would just queue
 * redundant reserves reads behind the same on-chain block.
 */
const LIVE_REFRESH_THROTTLE_MS = 1_000;

interface UseLiveTradeQuoteParams {
  token: Token;
  mode: "buy" | "sell";
  amount: string;
  slippage: number;
}

interface UseLiveTradeQuoteResult {
  buyQuote: BuyQuote | null;
  sellQuote: SellQuote | null;
}

/**
 * Live trade-quote hook for the token-page buy/sell panel.
 *
 * Owns the `BuyQuote` / `SellQuote` state and keeps it fresh across two
 * cadences:
 *
 *   1. **User input** — debounced ~`USER_INPUT_DEBOUNCE_MS`ms after each
 *      `amount` / `mode` / `slippage` / `token` edit. Same shape as the
 *      previous inline effect in `TradePanel`.
 *   2. **On-chain price drift** — throttled to ~`LIVE_REFRESH_THROTTLE_MS`ms,
 *      driven by the same `trade` (token-scoped) and `price` (LT-scoped)
 *      WebSocket channels that drive the chart's live candle. Without this
 *      the "You receive ≈ …" estimate stayed frozen at the last
 *      typed-quote value while the chart, mcap, and price ticked
 *      underneath as other users traded.
 *
 * Stale-fetch protection: every fetch increments a monotonic request id;
 * only the latest id's resolution is committed to state. This guarantees
 * that an in-flight WS-driven refetch can never clobber a fresher
 * user-input quote (or vice versa) when their on-chain reads land out of
 * order.
 *
 * `buyQuote` / `sellQuote` are returned independently — the panel reads
 * whichever side matches the active `mode`. The inactive side is left
 * untouched on mode flips so toggling back to it shows the prior result
 * (the panel clears `amount` on mode toggle anyway, which then nulls
 * both quotes via the empty-input branch below).
 *
 * Degrades gracefully when `VITE_WS_URL` is unset (local dev / preview):
 * `getWebSocketClient()` returns null and the WS-refresh effect short-
 * circuits — quotes still refresh on every user edit, just not on
 * background trades by other users.
 */
export function useLiveTradeQuote({
  token,
  mode,
  amount,
  slippage,
}: UseLiveTradeQuoteParams): UseLiveTradeQuoteResult {
  const [buyQuote, setBuyQuote] = useState<BuyQuote | null>(null);
  const [sellQuote, setSellQuote] = useState<SellQuote | null>(null);

  const amtNum = parseFloat(amount) || 0;
  const hasAmount = amtNum > 0;

  // Snapshot of the backing LT's directory row — driven by the 30s
  // `useLeveragedTokens` query. Used as:
  //   - the *seed* for `exchangeRate` before the first `price` WS tick
  //     lands (the WS handler then takes over with sub-second values);
  //   - the *sole* source for `baseAssetBalance` (the WS layer doesn't
  //     broadcast it — see `LtTicker`, which only fans out exchange rate).
  // 30s freshness on `baseAssetBalance` is fine — the idle-USDC buffer
  // moves only when a redeem lands, and the sell-side slippage discount
  // (`safeBufferUsdc = bufferUsdc × (1 - slippage)`) already absorbs
  // worst-case intra-window drift. See `tradeRouter.getQuoteSell` for the
  // full rationale.
  const lt = useLeveragedToken(token.ltAddress);
  // Latest WS-broadcast exchange rate. Held in a ref (not state) so a
  // 1Hz tick doesn't re-render every consumer of this hook — the quote
  // refresh is already throttled to the same cadence via
  // `createTradeFeedInvalidator`. Cleared in the WS effect's cleanup so
  // a token / LT change can't leak the previous LT's rate into the next
  // token's quote.
  const liveExchangeRateRef = useRef<bigint | null>(null);

  // Latest fetch params held in a ref so the WS-driven refetch can re-quote
  // against the user's *current* amount/mode without re-subscribing to the
  // WS channels (and without retriggering the user-input debounce). The
  // ref is synced inside an effect (not during render) per React 19's
  // `react-hooks/refs` rule — the WS callback always reads through
  // `paramsRef.current` after the commit phase has run, so the
  // sync-after-render order is safe in practice.
  const paramsRef = useRef<{
    tokenAddress: string;
    leverage: number;
    mode: "buy" | "sell";
    amtNum: number;
    slippage: number;
    exchangeRateWei: bigint | undefined;
    baseAssetBalanceWei: bigint | undefined;
  }>({
    tokenAddress: token.address,
    leverage: token.leverage,
    mode,
    amtNum,
    slippage,
    exchangeRateWei: undefined,
    baseAssetBalanceWei: undefined,
  });
  useEffect(() => {
    // Prefer the live WS rate when we have one (sub-second fresh), fall
    // back to the directory snapshot (≤30s fresh), let the router fall
    // back to RPC only if both are missing. `baseAssetBalance` has no WS
    // path, so the directory is the only override source.
    const directoryRate = parseLtAmount(lt?.exchangeRate);
    const exchangeRateWei = liveExchangeRateRef.current ?? directoryRate;
    const baseAssetBalanceWei = parseLtAmount(lt?.baseAssetBalance);
    paramsRef.current = {
      tokenAddress: token.address,
      leverage: token.leverage,
      mode,
      amtNum,
      slippage,
      exchangeRateWei,
      baseAssetBalanceWei,
    };
  });

  // Monotonic id so late-arriving stale fetches don't clobber a fresher
  // quote. Both code paths (debounced user input AND WS-throttled refresh)
  // share this counter so an out-of-order resolve from either branch is
  // discarded the same way.
  const reqIdRef = useRef(0);

  const fetchQuote = useCallback(async () => {
    const params = paramsRef.current;
    if (!params.amtNum || params.amtNum <= 0) return;

    const id = ++reqIdRef.current;
    // Bundle the LT overrides once so both branches read the same
    // snapshot. `exchangeRateWei` may be `undefined` when neither WS nor
    // directory has data yet — the router falls back to `LT.exchangeRate()`
    // over RPC for that first-quote case, then every subsequent quote
    // rides the override path.
    const overrides = {
      exchangeRateWei: params.exchangeRateWei,
      baseAssetBalanceWei: params.baseAssetBalanceWei,
    };
    try {
      if (params.mode === "buy") {
        const quote = await tradeRouterService.getQuoteBuy(
          params.tokenAddress,
          params.amtNum,
          overrides,
        );
        if (id !== reqIdRef.current) return;
        setBuyQuote(quote);
      } else {
        const quote = await tradeRouterService.getQuoteSell(
          params.tokenAddress,
          params.amtNum,
          params.slippage,
          params.leverage,
          overrides,
        );
        if (id !== reqIdRef.current) return;
        setSellQuote(quote);
      }
    } catch {
      // Quote failed (RPC error, missing pair, degraded LT). Clear the
      // active mode's quote rather than leaving a stale value behind —
      // sell-side quotes carry the LT idle-buffer state (`exceedsBuffer`,
      // `usdcOut`) that gates the SELL CTA, and a stale post-failure
      // quote could enable the button against an outdated buffer (and
      // potentially-changed amount) and revert on-chain at submit time.
      // The "…" placeholder rendered by `TradePanelQuote` for a null
      // quote is the honest signal that we don't currently have a
      // trustworthy estimate; the next debounce / WS tick re-quotes
      // and refills it. `tradeRouterService` already logs the
      // diagnostic to the console for developers.
      if (id !== reqIdRef.current) return;
      if (params.mode === "buy") {
        setBuyQuote(null);
      } else {
        setSellQuote(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!hasAmount) {
      setBuyQuote(null);
      setSellQuote(null);
      // Bump the req id so any in-flight request from a previous amount
      // can't commit after the user clears the input (e.g. a slow RPC
      // resolve landing after backspace would otherwise repopulate the
      // quote box for an empty input).
      reqIdRef.current += 1;
      return;
    }

    const timeout = setTimeout(() => {
      void fetchQuote();
    }, USER_INPUT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
    // `fetchQuote` is stable (empty deps + ref-driven inputs); listed for
    // exhaustive-deps. The effect re-runs on the actual user-input
    // signals — amount, mode, slippage, token identity / leverage.
  }, [hasAmount, amtNum, mode, token.address, token.leverage, slippage, fetchQuote]);

  useEffect(() => {
    if (!hasAmount) return;

    const ws = getWebSocketClient();
    if (!ws) return;

    const normalizedToken = token.address.toLowerCase();
    const normalizedLt = token.ltAddress?.toLowerCase();

    const invalidator = createTradeFeedInvalidator(() => {
      void fetchQuote();
    }, LIVE_REFRESH_THROTTLE_MS);

    // `trade` channel is sharded per token at the API edge, so in practice
    // every payload landing on this subscription is for `normalizedToken`
    // already. The `tokenAddress` check is a defensive belt-and-braces
    // (matches `useTokenLiveFeed` / `useChartData`) — guards against a
    // malformed broadcast or a future shard-leak from collapsing the
    // address gate.
    const unsubTrade = ws.subscribe(
      "trade",
      (data) => {
        if (data === null || typeof data !== "object") return;
        const raw = data as { tokenAddress?: string };
        if (raw.tokenAddress?.toLowerCase() !== normalizedToken) return;
        invalidator.handle();
      },
      normalizedToken,
    );

    // `price` channel ticks at LtTicker's ~1 s cadence even when no trade
    // happens — this is what keeps the quote tracking pure exchange-rate
    // drift on the underlying LT (e.g. HYPE / ETH price moves) without
    // requiring a trade on this token. Skip when `ltAddress` is missing
    // (token still loading); the effect re-runs once it resolves.
    //
    // The payload includes the raw wei-scaled `exchangeRate` (see
    // `apps/api/src/websocket/lt-ticker.ts`). We capture it into the
    // ref *and* propagate to `paramsRef.current.exchangeRateWei`
    // synchronously here — the alternative (waiting for the next render
    // to sync via the params effect) would race the throttled
    // `invalidator.handle()` and `fetchQuote` could read a stale rate.
    const unsubPrice = normalizedLt
      ? ws.subscribe(
          "price",
          (data) => {
            if (data === null || typeof data !== "object") return;
            const raw = data as { ltAddress?: string; exchangeRate?: string };
            if (raw.ltAddress?.toLowerCase() !== normalizedLt) return;
            const parsed = parseLtAmount(raw.exchangeRate);
            if (parsed !== undefined) {
              liveExchangeRateRef.current = parsed;
              paramsRef.current.exchangeRateWei = parsed;
            }
            invalidator.handle();
          },
          normalizedLt,
        )
      : () => {};

    return () => {
      unsubTrade();
      unsubPrice();
      invalidator.dispose();
      // Token / LT changed (or the panel unmounted). Drop the cached
      // live rate so a re-mount against a different LT can't quote
      // against the previous LT's exchange rate.
      liveExchangeRateRef.current = null;
    };
  }, [hasAmount, token.address, token.ltAddress, fetchQuote]);

  return { buyQuote, sellQuote };
}
