import { useMemo } from "react";

import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import styles from "./DropdownMenu.module.css";
import {
  TARGET_ASSETS,
  getAvailableLeverages,
  type TargetAssetType,
} from "../../../../constants/targetAssets";
import {
  useFetchTargetAssetsData,
  type TargetAssetsMarketData,
} from "../../../../hooks/useFetchTargetAssetsData";
import { useIsMobile } from "../../../../hooks/useIsMobile";
import {
  selectSelectedTargetAsset,
  selectLeverage,
  selectLongOrShort,
  setIsTokenDropdownOpen,
  setSelectedTargetAsset,
} from "../../../../state/mintSlice";
import { formatNumber } from "../../../../utils/formatNumber.util";
import { getLeverageTokenSymbol } from "../../../../utils/getLeverageTokenSymbol.util";
import { positiveOrNegativeClassName } from "../../../../utils/positiveOrNegativeClassName.util";
import SortHeader from "../../../Global/Table/SortHeader/SortHeader";

interface DropdownTableProps {
  searchValue: string;
  sortKey: string;
  sortDirection: "asc" | "desc";
  setSortKey: (key: string) => void;
  setSortDirection: (direction: "asc" | "desc") => void;
}

const DropdownTable = ({
  searchValue,
  sortKey,
  sortDirection,
  setSortKey,
  setSortDirection,
}: DropdownTableProps) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const selectedTargetAsset = useSelector(selectSelectedTargetAsset);
  const selectedLeverage = useSelector(selectLeverage);
  const selectedLongOrShort = useSelector(selectLongOrShort);
  const targetAssetData = useFetchTargetAssetsData();

  const handleTokenSelect = (token: TargetAssetType) => {
    dispatch(setIsTokenDropdownOpen(false));
    dispatch(setSelectedTargetAsset(token));
    const availableLeverages = getAvailableLeverages(
      token,
      selectedLongOrShort,
    );
    const leverage = availableLeverages.includes(selectedLeverage)
      ? selectedLeverage
      : availableLeverages.reduce((prev, curr) =>
          Math.abs(curr - selectedLeverage) < Math.abs(prev - selectedLeverage)
            ? curr
            : prev,
        );
    navigate(
      `/mint/${getLeverageTokenSymbol(token.symbol, leverage, selectedLongOrShort)}`,
    );
  };

  const filteredTokens = TARGET_ASSETS.filter((token) =>
    token.searchTerms.some((term) =>
      term.toLowerCase().includes(searchValue.toLowerCase()),
    ),
  );

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const tokenDataMap = useMemo(() => {
    const map: Record<string, TargetAssetsMarketData> = {};

    targetAssetData?.forEach((t) => {
      map[t.symbol] = t;
    });

    return map;
  }, [targetAssetData]);

  const sortedTokens = useMemo(() => {
    return [...filteredTokens].sort((a, b) => {
      const tokenA = tokenDataMap[a.symbol];
      const tokenB = tokenDataMap[b.symbol];

      let valA: string | number, valB: string | number;
      switch (sortKey) {
        case "price":
          valA = tokenA?.price ?? 0;
          valB = tokenB?.price ?? 0;
          break;
        case "change":
          valA = tokenA?.change24h ?? 0;
          valB = tokenB?.change24h ?? 0;
          break;
        case "volume":
          valA = tokenA?.volume24h ?? 0;
          valB = tokenB?.volume24h ?? 0;
          break;
        default:
          valA = a.symbol;
          valB = b.symbol;
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortDirection === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      } else if (typeof valA === "number" && typeof valB === "number") {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      } else {
        return 0;
      }
    });
  }, [filteredTokens, sortKey, sortDirection, tokenDataMap]);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <SortHeader
            title="Asset"
            headerActive={sortKey === "symbol"}
            sortDirection={sortDirection}
            handleSort={() => handleSort("symbol")}
          />
          <SortHeader
            title="Last Price"
            headerActive={sortKey === "price"}
            sortDirection={sortDirection}
            handleSort={() => handleSort("price")}
          />
          <SortHeader
            title="24h Change"
            headerActive={sortKey === "change"}
            sortDirection={sortDirection}
            handleSort={() => handleSort("change")}
            divClassname={"endAlignMobile"}
          />
          {!isMobile && (
            <SortHeader
              title="24h Volume"
              headerActive={sortKey === "volume"}
              sortDirection={sortDirection}
              handleSort={() => handleSort("volume")}
            />
          )}
        </tr>
      </thead>
      <tbody>
        {!sortedTokens.length && (
          <tr>
            <td colSpan={isMobile ? 3 : 4} className={styles.noResults}>
              <div className={styles.noResultsInner}>No search results</div>
            </td>
          </tr>
        )}
        {sortedTokens.map((token) => {
          const data = tokenDataMap[token.symbol];
          return (
            <tr
              key={token.id}
              onClick={() => handleTokenSelect(token)}
              className={
                token.id === selectedTargetAsset.id ? styles.selected : ""
              }
            >
              <td className={styles.coinCell}>
                <img src={token.image} alt={`${token.symbol} logo`} />
                <span>{token.symbol}</span>
              </td>
              <td>{formatNumber(data?.price, false, false, true)}</td>
              <td
                className={`${positiveOrNegativeClassName(data?.change24h)} ${
                  styles.change
                }`}
              >
                {formatNumber(data?.change24h, false, false) +
                  " / " +
                  formatNumber(data?.change24hPct, true)}
              </td>
              {!isMobile && (
                <td>{formatNumber(data?.volume24h, false, true, true)}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default DropdownTable;
