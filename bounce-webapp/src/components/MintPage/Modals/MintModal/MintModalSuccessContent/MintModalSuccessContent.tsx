import { useSelector } from "react-redux";

import { blockExplorerTx } from "../../../../../app/constants";
import { LaunchIcon } from "../../../../../assets/LaunchIcon";
import LeveragedToken from "../../../../../assets/LeveragedToken/LeveragedToken";
import { TickRoundle } from "../../../../../assets/TickRoundle";
import { baseAsset } from "../../../../../constants/baseAsset";
import { selectMintedAmountBigInt } from "../../../../../state/mintSlice";
import { bigIntToNumber } from "../../../../../utils/bigIntToNumber.util";
import formatAddress from "../../../../../utils/formatAddress.util";
import { formatBalance } from "../../../../../utils/formatBalance.util";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import Button from "../../../../Global/Buttons/Button";
import styles from "../MintModalContainer.module.css";

import type { LeveragedTokenData } from "../../../../../types/leverageTokenData";
import type { MintModalStates } from "../../../MintForm/MintForm";
import type { Address } from "viem";

interface MintModalSuccessContentProps {
  leverageToken: LeveragedTokenData;
  leverageTokenSymbol: string;
  hash: Address | undefined;
  setMintModalStage: (stage: MintModalStates) => void;
}

const MintModalSuccessContent = ({
  leverageToken,
  leverageTokenSymbol,
  hash,
  setMintModalStage,
}: MintModalSuccessContentProps) => {
  const mintedAmountBigInt = useSelector(selectMintedAmountBigInt);

  if (mintedAmountBigInt == null) return null;

  const value = bigIntToNumber(
    (mintedAmountBigInt * leverageToken.exchangeRate) / 10n ** 18n,
    18,
  );

  return (
    <div className={styles.outer}>
      <div className={styles.titleContainer}>
        <TickRoundle />
        <h2 className={styles.successTitle}>Mint Successful!</h2>
      </div>
      <div className={styles.token}>
        <LeveragedToken
          size={{ height: 60, width: 60 }}
          leverage={leverageToken.targetLeverage}
          long={leverageToken.isLong}
          token={leverageToken.targetAsset}
        />
        <span>{leverageTokenSymbol}</span>
      </div>
      <div className={styles.positionValue}>
        <span>Nominal value</span>
        <span>
          {formatNumber(value)} {baseAsset.symbol}
        </span>
      </div>
      <div className={styles.informationTable}>
        <div className={styles.informationRow}>
          <span>Amount received</span>
          <span>
            {mintedAmountBigInt
              ? formatBalance(mintedAmountBigInt, 18, 2, 2)
              : ""}{" "}
            {leverageTokenSymbol}
          </span>
        </div>

        <div className={styles.informationRow}>
          <span>Transaction hash</span>
          {hash ? (
            <span>
              <a
                href={blockExplorerTx(hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {formatAddress(hash ?? null)}
                <span>{LaunchIcon("var(--grey-500-or-white)")}</span>
              </a>
            </span>
          ) : (
            <span>Loading...</span>
          )}
        </div>
      </div>
      <Button
        variant="primary"
        wide
        onClick={() => setMintModalStage("closed")}
      >
        Close
      </Button>
    </div>
  );
};

export default MintModalSuccessContent;
