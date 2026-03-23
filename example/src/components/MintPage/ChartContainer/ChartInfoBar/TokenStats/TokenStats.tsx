import { useEffect } from "react";

import { useSelector } from "react-redux";

import styles from "./TokenStats.module.css";
import { useFetchTargetAssetsData } from "../../../../../hooks/useFetchTargetAssetsData";
import { selectSelectedTargetAsset } from "../../../../../state/mintSlice";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { positiveOrNegativeClassName } from "../../../../../utils/positiveOrNegativeClassName.util";

const TokenStats = ({
  livePrice,
  setLivePrice,
}: {
  livePrice: number | null;
  setLivePrice: (price: number | null) => void;
}) => {
  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const targetAssetData = useFetchTargetAssetsData();

  const selectedTokenStats = targetAssetData?.find(
    (t) => t.symbol === selectedTargetAsset.symbol,
  );

  useEffect(() => {
    if (!selectedTargetAsset) return;
    setLivePrice(selectedTokenStats?.price ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTargetAsset.symbol]);

  return (
    <div className={styles.tokenStatsWrapper}>
      <div className={styles.tokenStats}>
        <div className={styles.stat}>
          <p>Price</p>
          <span>
            {livePrice
              ? formatNumber(livePrice, false, false, true)
              : formatNumber(selectedTokenStats?.price, false, false, true)}
          </span>
        </div>
        <div className={styles.stat}>
          <p>24h Change</p>
          <span
            className={positiveOrNegativeClassName(
              selectedTokenStats?.change24h,
            )}
          >
            {formatNumber(selectedTokenStats?.change24h) +
              " / " +
              formatNumber(selectedTokenStats?.change24hPct, true)}
          </span>
        </div>
        <div className={styles.stat}>
          <p>24hr Volume</p>
          <span>
            {formatNumber(selectedTokenStats?.volume24h, false, true)}
          </span>
        </div>
        <div className={styles.stat}>
          <p>Open Interest</p>
          <span>{formatNumber(selectedTokenStats?.openInterest)}</span>
        </div>
      </div>
    </div>
  );
};

export default TokenStats;
