import { useState } from "react";

import { Link } from "react-router";

import styles from "./TradesList.module.css";
import TradesRow from "./TradesRow";
import { MINT_ROUTE } from "../../../app/routes";
import useAllUserTrades, {
  type TradesSortByOptions,
} from "../../../hooks/Indexer/useTrades";
import Button from "../Buttons/Button";
import Pagination from "../Pagination/Pagination";
import Skeleton from "../Skeleton/Skeleton";
import SortHeader from "../Table/SortHeader/SortHeader";
import ZeroStateContainer from "../ZeroStateContainer/ZeroStateContainer";

const ITEMS_PER_PAGE = 8;

const PNL_SORT_CYCLE: Array<{
  key: TradesSortByOptions;
  direction: "asc" | "desc";
}> = [
  { key: "pnlAmount", direction: "asc" },
  { key: "pnlAmount", direction: "desc" },
  { key: "pnlPercent", direction: "asc" },
  { key: "pnlPercent", direction: "desc" },
];

const TradesList = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<TradesSortByOptions>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const { data } = useAllUserTrades({
    page: currentPage,
    limit: ITEMS_PER_PAGE,
    sortBy: sortKey,
    sortOrder: sortDirection,
  });

  const trades = data?.items;
  const totalPages = data?.totalPages ?? 1;

  const handleSort = (key: TradesSortByOptions) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const handlePnlSort = () => {
    const currentIndex = PNL_SORT_CYCLE.findIndex(
      (s) => s.key === sortKey && s.direction === sortDirection,
    );

    const next =
      currentIndex === -1
        ? PNL_SORT_CYCLE[0]
        : PNL_SORT_CYCLE[(currentIndex + 1) % PNL_SORT_CYCLE.length];

    setSortKey(next.key);
    setSortDirection(next.direction);
    setCurrentPage(1);
  };

  const getPnlHeaderTitle = () => {
    if (sortKey === "pnlAmount") return "Closed PnL";
    if (sortKey === "pnlPercent") return "Closed PnL %";
    return "Closed PnL";
  };

  const isPnlActive = sortKey === "pnlAmount" || sortKey === "pnlPercent";

  if (trades?.length === 0)
    return (
      <ZeroStateContainer>
        <p>You have no trade history yet.</p>
        <Link to={`/${MINT_ROUTE}`}>
          <Button variant="primary">Mint a Leverage Token</Button>
        </Link>
      </ZeroStateContainer>
    );

  return (
    <div className={styles.outerContainer}>
      <div className={styles.tableContainer}>
        <table className={styles.positionList}>
          <thead>
            <tr className={styles.tableHeader}>
              <SortHeader
                title="Asset"
                headerActive={sortKey === "targetAsset"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("targetAsset")}
              />
              <SortHeader
                title="Date / Time"
                headerActive={sortKey === "date"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("date")}
              />
              <SortHeader
                title="Activity"
                headerActive={sortKey === "activity"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("activity")}
              />
              <SortHeader
                title="Nominal Value"
                headerActive={sortKey === "nomVal"}
                sortDirection={sortDirection}
                handleSort={() => handleSort("nomVal")}
              />
              <SortHeader
                title={getPnlHeaderTitle()}
                headerActive={isPnlActive}
                sortDirection={sortDirection}
                handleSort={handlePnlSort}
                divClassname="endAlign"
              />
            </tr>
          </thead>
          <tbody>
            {!data
              ? Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i} className={styles.tableRow}>
                    <td colSpan={5} className={styles.skeletonCell}>
                      <Skeleton height={4.2} width="100%" />
                    </td>
                  </tr>
                ))
              : trades?.map((trade) => (
                  <TradesRow key={trade.id} trade={trade} />
                ))}
          </tbody>
        </table>
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        isLoading={!data}
        onPageChange={setCurrentPage}
      />
    </div>
  );
};

export default TradesList;
