import React from "react";

import { getLeverageTokenSymbol } from "../../utils/getLeverageTokenSymbol.util";

import type { Asset } from "../../constants/targetAssetsBase";

const LeveragedToken: React.FC<{
  size: { height: number; width: number };
  leverage: number;
  long: boolean;
  token: Asset;
}> = React.memo(({ size, leverage, long, token }) => {
  const symbol = getLeverageTokenSymbol(
    token,
    leverage,
    long ? "long" : "short",
  );

  return (
    <img
      src={`/leveraged-tokens/${symbol}.png`}
      alt={symbol}
      width={size.width}
      height={size.height}
    />
  );
});

export default LeveragedToken;
