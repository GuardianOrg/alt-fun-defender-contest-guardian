import styles from "./TokenInformation.module.css";
import LeveragedToken from "../../../../../../assets/LeveragedToken/LeveragedToken";
import { baseAsset } from "../../../../../../constants/baseAsset";
import { formatBalance } from "../../../../../../utils/formatBalance.util";

import type { LeveragedTokenData } from "../../../../../../types/leverageTokenData";

interface TokenInformationProps {
  leverageToken: LeveragedTokenData;
  usdcBalanceEquivalent: string;
}

const TokenInformation = ({
  leverageToken,
  usdcBalanceEquivalent,
}: TokenInformationProps) => {
  return (
    <div>
      <p>Asset to Redeem</p>
      <div className={styles.positionValue}>
        <LeveragedToken
          size={{ height: 30, width: 30 }}
          leverage={leverageToken.targetLeverage}
          long={leverageToken.isLong}
          token={leverageToken.targetAsset}
        />
        <span>{leverageToken.symbol}</span>
      </div>
      <div className={styles.userBalance}>
        <>
          Balance: {formatBalance(leverageToken.balanceOf, 18, 2, 2)}{" "}
          {leverageToken.symbol}
        </>
        <span>
          (= {usdcBalanceEquivalent} {baseAsset.symbol})
        </span>
      </div>
    </div>
  );
};

export default TokenInformation;
