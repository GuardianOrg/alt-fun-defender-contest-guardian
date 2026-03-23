import { useState } from "react";

import Chart from "./Chart/Chart";
import styles from "./ChartContainer.module.css";
import ChartInfoBar from "./ChartInfoBar/ChartInfoBar";
import IntervalSelector from "./IntervalSelector/IntervalSelector";

const ChartContainer = () => {
  const [livePrice, setLivePrice] = useState<number | null>(null);
  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartInfoBar}>
        <ChartInfoBar livePrice={livePrice} setLivePrice={setLivePrice} />
      </div>
      <div className={styles.chart}>
        <IntervalSelector />
        <Chart setLivePrice={setLivePrice} />
      </div>
    </div>
  );
};
export default ChartContainer;
