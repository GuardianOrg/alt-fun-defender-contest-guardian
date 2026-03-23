import { useCallback, useMemo, useState } from "react";

import styles from "./PositionList.module.css";
import PositionRow from "./PositionRow";
import { pnlDisclaimerCopy } from "../../../constants/pnlDisclaimerCopy";
import Pagination from "../Pagination/Pagination";
import SortHeader from "../Table/SortHeader/SortHeader";

import type { LeveragedTokenData } from "../../../types/leverageTokenData";

interface PositionListProps {
  positions: LeveragedTokenData[];
}

const ITEMS_PER_PAGE = 8;

const PositionList = ({ positions }: PositionListProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<string>("asset");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [unrealizedPnlMap, setUnrealizedPnlMap] = useState<Map<string, number>>(
    new Map(),
  );

  const registerUnrealizedPnl = useCallback(
    (symbol: string, unrealizedPnl?: number) => {
      setUnrealizedPnlMap((prev) => {
        const next = new Map(prev);
        next.set(symbol, unrealizedPnl ?? 0);
        return next;
      });
    },
    [],
  );

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  console.log("Positions:", positions);

  const sortedPositions = useMemo(() => {
    if (!positions) return [];
    return [...positions].sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case "asset":
          comparison = (a.symbol || "").localeCompare(b.symbol || "");
          break;
        case "nominalValue":
          comparison =
            Number(a.balanceOf) * Number(a.exchangeRate) -
            Number(b.balanceOf) * Number(b.exchangeRate);
          break;
        case "uPnL": {
          const pnlA = unrealizedPnlMap.get(a?.symbol || "") ?? 0;
          const pnlB = unrealizedPnlMap.get(b.symbol || "") ?? 0;
          comparison = pnlA - pnlB;
          break;
        }
        default:
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [positions, sortKey, sortDirection, unrealizedPnlMap]);

  const totalPages = Math.ceil(positions.length / ITEMS_PER_PAGE);
  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentItems = sortedPositions.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE,
  );

  return (
    <div className={styles.outerContainer}>
      <div className={styles.tableContainer}>
        <table className={styles.positionList}>
          <thead>
            <tr className={styles.tableHeader}>
              <SortHeader
                title="Asset"
                headerActive={sortKey === "asset"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("asset")}
              />
              <SortHeader
                title="Nominal Value"
                headerActive={sortKey === "nominalValue"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("nominalValue")}
              />
              <SortHeader
                title="uPnL"
                headerActive={sortKey === "uPnL"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("uPnL")}
                tooltip={pnlDisclaimerCopy}
              />
              <th />
            </tr>
          </thead>
          <tbody>
            {currentItems.map((position) => (
              <PositionRow
                key={position.symbol}
                position={position}
                onUnrealizedPnl={registerUnrealizedPnl}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
    </div>
  );
};

export default PositionList;
