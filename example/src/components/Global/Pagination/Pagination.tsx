import styles from "./Pagination.module.css";
import { getPaginationRange } from "./Pagination.utils";
import { ArrowBack } from "../../../assets/ArrowBack";
import { ArrowForward } from "../../../assets/ArrowForward";
import Skeleton from "../Skeleton/Skeleton";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
}

const Pagination = ({
  currentPage,
  totalPages,
  isLoading,
  onPageChange,
}: PaginationProps) => {
  if (isLoading) {
    return (
      <div className={styles.pagination}>
        <Skeleton height={2.5} width={20} />
      </div>
    );
  }

  if (totalPages <= 1) return null;

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    onPageChange(page);
  };

  return (
    <div className={styles.pagination}>
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={styles.navButton}
      >
        <div className={styles.arrow}>
          {ArrowBack("var(--grey-500-or-white)")}
        </div>
        Previous
      </button>

      {getPaginationRange(totalPages, currentPage).map((page, i) =>
        page === "..." ? (
          <span key={i} className={styles.ellipsis}>
            ...
          </span>
        ) : (
          <button
            key={i}
            className={`${styles.pageButton} ${
              currentPage === page ? styles.activePageButton : ""
            }`}
            onClick={() => handlePageChange(Number(page))}
          >
            {page}
          </button>
        ),
      )}

      <button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={styles.navButton}
      >
        Next
        <div className={styles.arrow}>
          {ArrowForward("var(--grey-500-or-white)")}
        </div>
      </button>
    </div>
  );
};

export default Pagination;
