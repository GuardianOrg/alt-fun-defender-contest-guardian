import usePnl, { type LeveragedTokenPnl } from "./Indexer/usePnl";

import type { Address } from "viem";

const useLeveragedTokenPnl = (
  leveragedTokenAddress: Address | null | undefined,
): LeveragedTokenPnl | null => {
  const pnl = usePnl();

  if (!leveragedTokenAddress) return null;
  if (!pnl) return null;
  if (!pnl.leveragedTokens) return null;
  const leveragedTokenPnl =
    pnl.leveragedTokens[leveragedTokenAddress.toLowerCase() as Address];
  if (!leveragedTokenPnl) return null;
  return leveragedTokenPnl;
};

export default useLeveragedTokenPnl;
