import { useState } from "react";

import AdvancedChart from "./AdvancedChart/AdvancedChart";
import styles from "./ChartContainer.module.css";
import ChartInfoBar from "./ChartInfoBar/ChartInfoBar";

const ChartContainer = () => {
  const [livePrice, setLivePrice] = useState<number | null>(null);

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartInfoBar}>
        <ChartInfoBar livePrice={livePrice} setLivePrice={setLivePrice} />
      </div>
      <div className={styles.chart}>
        <AdvancedChart setLivePrice={setLivePrice} />
      </div>
    </div>
  );
};
export default ChartContainer;
