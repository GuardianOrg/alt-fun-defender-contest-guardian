import { useState } from "react";

import { AnimatePresence, motion } from "framer-motion";

import AddressLink from "./AddressLink";
import styles from "./Leaderboard.module.css";
import useLiquidationLeaderboardData, {
  type LiquidationLeaderboardSortByOptions,
} from "../../../hooks/useLiquidationLeaderboardData";
import { formatNumber } from "../../../utils/formatNumber.util";
import Pagination from "../../Global/Pagination/Pagination";
import Skeleton from "../../Global/Skeleton/Skeleton";
import SortHeader from "../../Global/Table/SortHeader/SortHeader";

import type { LiquidationJourneyData } from "../../../hooks/useLiquidationJourneyData";

interface LeaderboardProps {
  userData?: LiquidationJourneyData | null;
}

const Leaderboard = ({ userData }: LeaderboardProps) => {
  const [sortKey, setSortKey] = useState<LiquidationLeaderboardSortByOptions>(
    "totalLiquidationNotional",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [rankOrTotalLiquidatedSelected, setRankOrTotalLiquidatedSelected] =
    useState<"rank" | "totalLiquidated">("rank");
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading } = useLiquidationLeaderboardData({
    page: currentPage,
    sortBy: sortKey,
    sortOrder,
  });

  const handleSort = (key: LiquidationLeaderboardSortByOptions) => {
    setCurrentPage(1);

    setSortOrder((prev) =>
      key === sortKey ? (prev === "asc" ? "desc" : "asc") : "asc",
    );

    setSortKey(key);
  };

  return (
    <div className={styles.leaderboardCard}>
      <h3 className={styles.title}>
        <span>🏆</span>Leaderboard
      </h3>
      <div className={styles.tableContainer}>
        <table>
          <thead>
            <tr className={styles.tableHeader}>
              <SortHeader
                title="Rank"
                headerActive={
                  sortKey === "totalLiquidationNotional" &&
                  rankOrTotalLiquidatedSelected === "rank"
                }
                sortDirection={sortOrder}
                handleSort={() => {
                  setRankOrTotalLiquidatedSelected("rank");
                  handleSort("totalLiquidationNotional");
                }}
              />
              <SortHeader
                title="Total Liquidated"
                headerActive={
                  sortKey === "totalLiquidationNotional" &&
                  rankOrTotalLiquidatedSelected === "totalLiquidated"
                }
                sortDirection={sortOrder}
                handleSort={() => {
                  setRankOrTotalLiquidatedSelected("totalLiquidated");
                  handleSort("totalLiquidationNotional");
                }}
              />
              <th>Wallet/ENS</th>
              <SortHeader
                title="Liquidation Score"
                headerActive={sortKey === "score"}
                sortDirection={sortOrder}
                handleSort={() => {
                  handleSort("score");
                }}
                divClassname="endAlign"
                tooltip="Liquidation score is based on total amount liquidated, total number of liquidations, and recency of liquidation."
              />
            </tr>
          </thead>

          <tbody>
            <AnimatePresence>
              {userData && userData.hasClaimed && userData.score > 0 && (
                <motion.tr
                  key="you"
                  className={`${styles.tableRow} ${styles.you}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.8,
                    ease: "easeOut",
                  }}
                >
                  <td className={styles.rankCell}>You ({userData.rank})</td>
                  <td>
                    {formatNumber(
                      userData.totalLiquidationNotional,
                      false,
                      true,
                    )}
                  </td>
                  <td>
                    <AddressLink
                      wallet={userData.user as `0x${string}`}
                      className={`${styles.walletLink} ${styles.youWalletLink}`}
                      iconColorVar="var(--grey-500-or-primary)"
                    />
                  </td>
                  <td>{userData.score.toLocaleString()}</td>
                </motion.tr>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {isLoading || !data
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className={styles.tableRow}>
                      <td colSpan={5} className={styles.skeletonCell}>
                        <Skeleton height={4.2} width="100%" />
                      </td>
                    </tr>
                  ))
                : data.items.map((entry) => (
                    <motion.tr
                      key={entry.address}
                      className={`${styles.tableRow} ${
                        entry.address.toLowerCase() ===
                        userData?.user.toLowerCase()
                          ? styles.userRow
                          : ""
                      }`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.8,
                        ease: "easeOut",
                      }}
                    >
                      <td>
                        <div className={styles.rankCell}>
                          {entry.rank === 1 && (
                            <span className={styles.medal}>🥇</span>
                          )}
                          {entry.rank === 2 && (
                            <span className={styles.medal}>🥈</span>
                          )}
                          {entry.rank === 3 && (
                            <span className={styles.medal}>🥉</span>
                          )}
                          <span className={styles.rankNumber}>
                            {entry.rank}
                          </span>
                        </div>
                      </td>
                      <td>
                        {formatNumber(
                          entry.totalLiquidationNotional,
                          false,
                          true,
                        )}
                      </td>
                      <td>
                        <AddressLink
                          wallet={entry.address}
                          className={styles.walletLink}
                          iconColorVar="var(--grey-500-or-white)"
                        />
                      </td>
                      <td>{entry.score.toLocaleString()}</td>
                    </motion.tr>
                  ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {data && (
        <Pagination
          currentPage={currentPage}
          totalPages={data.totalPages}
          isLoading={!data}
          onPageChange={setCurrentPage}
        />
      )}
    </div>
  );
};

export default Leaderboard;
