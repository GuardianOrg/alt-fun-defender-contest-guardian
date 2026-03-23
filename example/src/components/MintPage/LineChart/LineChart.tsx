import React from "react";

import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

import styles from "./LineChart.module.css";
import { useHyperliquidLineChart } from "../../../hooks/Hyperliquid/useHyperliquidLineChart";
import Skeleton from "../../Global/Skeleton/Skeleton";

import type { ChartTimeInterval } from "../../../constants/chartTimeIntervals";

ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
);

const LineChart = ({
  symbol,
  interval,
  profit,
}: {
  symbol: string;
  interval: ChartTimeInterval;
  profit: boolean;
}) => {
  const { prices, loading } = useHyperliquidLineChart({
    coin: symbol,
    interval,
  });

  const data = {
    labels: prices.map((_, i) => i),
    datasets: [
      {
        data: prices,
        borderColor: profit ? "#52be60" : "#f76960",
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
    ],
  };

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = (maxPrice - minPrice) * 0.2 || 0.5;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    scales: {
      x: { display: false },
      y: {
        display: false,
        min: minPrice - padding,
        max: maxPrice + padding,
      },
    },
  };

  return loading ? (
    <div className={styles.skeleton}>
      <Skeleton />
    </div>
  ) : (
    <Line data={data} options={options} />
  );
};

export default React.memo(LineChart);
