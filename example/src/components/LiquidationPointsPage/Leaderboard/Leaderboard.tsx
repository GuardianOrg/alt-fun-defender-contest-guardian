import { useState } from "react";

import { AnimatePresence, motion } from "framer-motion";

import AddressLink from "./AddressLink";
import styles from "./Leaderboard.module.css";
import Pagination from "../../Global/Pagination/Pagination";
import Skeleton from "../../Global/Skeleton/Skeleton";
import SortHeader from "../../Global/Table/SortHeader/SortHeader";

import type { LiquidationData } from "../../../hooks/useLiquidationData";

type SortKey = "rank" | "points" | "liquidations";
type SortOrder = "asc" | "desc";
interface LeaderboardProps {
  leaderboardArray?: LiquidationData[];
  userData?: LiquidationData;
}

const ITEMS_PER_PAGE = 8;

const Leaderboard = ({ leaderboardArray, userData }: LeaderboardProps) => {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  if (!leaderboardArray) {
    return <Skeleton height={30} width="100%" />;
  }

  const totalPages = Math.ceil(leaderboardArray.length / ITEMS_PER_PAGE);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const handleSort = (key: SortKey) => {
    setCurrentPage(1);

    setSortOrder((prev) =>
      key === sortKey ? (prev === "asc" ? "desc" : "asc") : "asc",
    );

    setSortKey(key);
  };

  const sortedLeaderboard = [...leaderboardArray].sort((a, b) => {
    const diff = a.points - b.points;
    return sortOrder === "asc" ? diff : -diff;
  });

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentItems = sortedLeaderboard.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE,
  );

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
                headerActive={sortKey === "rank"}
                sortDirection={sortOrder}
                handleSort={() => handleSort("rank")}
              />

              <SortHeader
                title="Liquidation Points"
                headerActive={sortKey === "points"}
                sortDirection={sortOrder}
                handleSort={() => handleSort("points")}
              />

              <th>Wallet/ENS</th>

              <SortHeader
                title="Liquidated USD Value"
                headerActive={sortKey === "liquidations"}
                sortDirection={sortOrder}
                handleSort={() => handleSort("liquidations")}
                divClassname={"endAlign"}
              />
            </tr>
          </thead>

          <tbody>
            <AnimatePresence>
              {userData && userData.claimed && userData.points > 0 && (
                <motion.tr
                  key={"you"}
                  className={`${styles.tableRow} ${styles.you}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <td className={styles.rankCell}>
                    You {userData?.rank && `(${userData.rank})`}
                  </td>
                  <td>{userData?.points.toLocaleString()}</td>
                  <td>
                    <AddressLink
                      wallet={userData.wallet}
                      className={`${styles.walletLink} ${styles.youWalletLink}`}
                      iconColorVar="var(--grey-500-or-primary)"
                    />
                  </td>
                  <td>${userData?.liquidations.toLocaleString()}</td>
                </motion.tr>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {currentItems.map((entry) => (
                <motion.tr
                  key={entry.wallet}
                  className={styles.tableRow}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <td>
                    <div className={styles.rankCell}>
                      {entry && entry.rank === 1 && (
                        <span className={styles.medal}>🥇</span>
                      )}
                      {entry && entry.rank === 2 && (
                        <span className={styles.medal}>🥈</span>
                      )}
                      {entry && entry.rank === 3 && (
                        <span className={styles.medal}>🥉</span>
                      )}
                      <span className={styles.rankNumber}>{entry.rank}</span>
                    </div>
                  </td>
                  <td>{entry.points.toLocaleString()}</td>
                  <td>
                    <AddressLink
                      wallet={entry.wallet}
                      className={styles.walletLink}
                      iconColorVar="var(--grey-500-or-white)"
                    />
                  </td>
                  <td>${entry.liquidations.toLocaleString()}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
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

export default Leaderboard;
