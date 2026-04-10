import { useCallback, useState } from "react";

import DropdownHeader from "./DropdownHeader/DropdownHeader";
import styles from "./TokenInformationDropdown.module.css";
import { blockExplorerAddress } from "../../../../app/constants";
import { LaunchIcon } from "../../../../assets/LaunchIcon";
import formatAddress from "../../../../utils/formatAddress.util";
import { getLeverageRange } from "../../../../utils/getLeverageRange.util";
import AnimatePresenceHeight from "../../../Global/AnimatePresenceHeight/AnimatePresenceHeight";

import type { LeveragedTokenData } from "../../../../types/leverageTokenData";

const TokenInformationDropdown = ({
  leverageTokenSymbol,
  leverageToken,
}: {
  leverageTokenSymbol: string;
  leverageToken?: LeveragedTokenData;
}) => {
  const [isTokenInformationDropdownOpen, setIsTokenInformationDropdownOpen] =
    useState(false);

  const toggleOpen = useCallback(() => {
    setIsTokenInformationDropdownOpen((prev) => !prev);
  }, []);

  const leverageRange = leverageToken
    ? getLeverageRange(
        leverageToken.targetAsset,
        leverageToken.targetLeverage,
        leverageToken.isLong,
      )
    : "--";

  return (
    <div
      className={styles.tokenInformationDropdown}
      data-testid="token-information-dropdown"
    >
      <DropdownHeader
        leverageTokenSymbol={leverageTokenSymbol}
        isOpen={isTokenInformationDropdownOpen}
        toggleOpen={toggleOpen}
      />

      {leverageToken && (
        <AnimatePresenceHeight
          shouldDisplay={isTokenInformationDropdownOpen}
          className={styles.tokenInformationDropdownContent}
        >
          {/* <div className={styles.item}>
            Open Interest
            <span>
              {leverageToken.isStandbyMode
                ? "Standby Mode"
                : formatNumber(
                    bigIntToNumber(leverageToken.totalAssets, 6) *
                      leverageToken.targetLeverage,
                    false,
                    true,
                  )}
            </span>
          </div> */}
          <div className={styles.item}>
            Leverage Range
            <span>{leverageRange}</span>
          </div>
          <div className={styles.item}>
            Address
            <span>
              <a
                href={blockExplorerAddress(leverageToken.address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {formatAddress(leverageToken.address)}
                <div className={styles.icon}>{LaunchIcon("var(--main)")}</div>
              </a>
            </span>
          </div>
        </AnimatePresenceHeight>
      )}
    </div>
  );
};

export default TokenInformationDropdown;
