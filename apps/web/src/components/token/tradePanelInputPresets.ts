import { formatUnits, parseUnits } from "viem";

import type { SellQuote } from "../../services/tradeRouter";

interface SellPresetAmount {
  value: string;
  wei: bigint;
}

export function getSellPresetAmount(
  maxBalanceWei: bigint | null,
  pct: number,
  sellQuote: Pick<SellQuote, "maxSellableTokens"> | null,
): SellPresetAmount | null {
  if (maxBalanceWei === null) return null;

  let resultWei = (maxBalanceWei * BigInt(pct)) / 100n;
  if (sellQuote && Number.isFinite(sellQuote.maxSellableTokens)) {
    try {
      const capWei = parseUnits(sellQuote.maxSellableTokens.toFixed(18), 18);
      if (capWei < resultWei) resultWei = capWei;
    } catch {
      // Ignore malformed quote caps; balance-derived amount is still valid.
    }
  }

  return {
    value: formatUnits(resultWei, 18),
    wei: resultWei,
  };
}

export function isSellPresetActive(
  amount: string,
  computedAmount: SellPresetAmount | null,
) {
  return (
    computedAmount !== null &&
    computedAmount.wei > 0n &&
    amount === computedAmount.value
  );
}
