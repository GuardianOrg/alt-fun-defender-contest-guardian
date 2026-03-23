import styles from "./DotsNavigation.module.css";

export type DotsNavigationProps = {
  count: number;
  activeIndex: number;
  onChange: (index: number) => void;
};

const DotsNavigation = ({
  count,
  activeIndex,
  onChange,
}: DotsNavigationProps) => {
  if (count <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Pagination"
      className={styles.dotsContainer}
    >
      {Array.from({ length: count }).map((_, index) => {
        const isActive = index === activeIndex;

        return (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Go to item ${index + 1}`}
            onClick={() => onChange?.(index)}
            className="relative flex items-center justify-center focus:outline-none"
          >
            <span
              className={`${styles.dot} ${isActive ? styles.activeDot : ""}`}
            />
          </button>
        );
      })}
    </div>
  );
};

export default DotsNavigation;
