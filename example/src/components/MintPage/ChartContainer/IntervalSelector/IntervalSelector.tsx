import { useDispatch, useSelector } from "react-redux";

import styles from "./IntervalSelector.module.css";
import { MarkersToggle } from "../../../../assets/MarkersToggle";
import {
  chartTimeIntervals,
  type ChartTimeInterval,
} from "../../../../constants/chartTimeIntervals";
import { useLiveTrades } from "../../../../hooks/useLiveTrades";
import {
  selectSelectedInterval,
  selectToggleMarkers,
  setSelectedInterval,
  setToggleMarkers,
} from "../../../../state/mintSlice";

const IntervalSelector = () => {
  const dispatch = useDispatch();

  const selectedInterval = useSelector(selectSelectedInterval);
  const toggleMarkers = useSelector(selectToggleMarkers);

  const trades = useLiveTrades();

  const handleIntervalSelect = (interval: ChartTimeInterval) => {
    dispatch(setSelectedInterval(interval));
  };
  const handleToggleMarkers = () => {
    dispatch(setToggleMarkers(!toggleMarkers));
  };

  const eventsToShow = trades && trades.length > 0;

  const toggleMarkerColor = toggleMarkers
    ? "var(--primary-500-or-white)"
    : "var(--grey-400)";

  const getTimezoneOffsetLabel = () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    if (offsetMinutes === 0) return "UTC";
    const sign = offsetMinutes > 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    if (minutes === 0) {
      return `UTC${sign}${hours}`;
    }
    return `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
  };

  return (
    <div className={styles.intervalSelectorContainer}>
      <div className={styles.intervalSelector}>
        {chartTimeIntervals.map((interval) => (
          <button
            key={interval}
            onClick={() => handleIntervalSelect(interval)}
            className={selectedInterval === interval ? styles.active : ""}
          >
            {interval}
          </button>
        ))}
      </div>
      <div className={styles.label}>{getTimezoneOffsetLabel()}</div>

      <div
        className={`${styles.toggleMarkersContainer} ${
          eventsToShow ? "" : styles.hidden
        }`}
      >
        <div className={styles.toggleLabel}>Toggle marks:</div>
        <button
          onClick={() => handleToggleMarkers()}
          className={`${styles.markerToggle}`}
        >
          <MarkersToggle color={toggleMarkerColor} />
        </button>
      </div>
    </div>
  );
};

export default IntervalSelector;
