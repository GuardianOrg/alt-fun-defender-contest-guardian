import { useCallback, useEffect, useRef, useState } from "react";

import { useLeveragedToken } from "./useLeveragedTokens";
import { createTradeFeedInvalidator } from "./useTokenLiveFeed";
import { tradeRouterService } from "../services/tradeRouter";
import { getWebSocketClient } from "../services/websocket";

import type { BuyQuote, SellQuote } from "../services/tradeRouter";
import type { Token } from "../services/types";

/** Parse trusted positive wei-scaled LT values; malformed values fall back to RPC. */
function parseLtAmount(raw: string | undefined): bigint | undefined {
  if (!raw) return undefined;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

const USER_INPUT_DEBOUNCE_MS = 300;

// WS-driven quotes require on-chain reads, so coalesce live trade/price ticks.
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

/** Live buy/sell quotes: debounce user input, throttle WS-driven price drift. */
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

  // Directory row seeds exchangeRate and is the only source for baseAssetBalance.
  const lt = useLeveragedToken(token.ltAddress);
  // Latest WS exchange rate; ref avoids a render on each 1Hz tick.
  const liveExchangeRateRef = useRef<bigint | null>(null);

  // Ref lets WS refresh quote current inputs without re-subscribing.
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
    // Prefer live rate, then directory snapshot, then router RPC fallback.
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

  // Monotonic id discards late user-input or WS refresh results.
  const reqIdRef = useRef(0);

  const fetchQuote = useCallback(async () => {
    const params = paramsRef.current;
    if (!params.amtNum || params.amtNum <= 0) return;

    const id = ++reqIdRef.current;
    // Bundle LT overrides once so buy/sell branches read the same snapshot.
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
      // Clear active quote on failure so stale buffer/amount data cannot enable a bad submit.
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
      // Invalidate in-flight quotes when the input is cleared.
      reqIdRef.current += 1;
      return;
    }

    const timeout = setTimeout(() => {
      void fetchQuote();
    }, USER_INPUT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
    // `fetchQuote` is stable; actual re-quote signals are listed above.
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

    // Keep the address gate even though the API shards trade channels by token.
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

    // Price ticks keep quotes tracking LT exchange-rate drift between trades.
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
      liveExchangeRateRef.current = null;
    };
  }, [hasAmount, token.address, token.ltAddress, fetchQuote]);

  return { buyQuote, sellQuote };
}
