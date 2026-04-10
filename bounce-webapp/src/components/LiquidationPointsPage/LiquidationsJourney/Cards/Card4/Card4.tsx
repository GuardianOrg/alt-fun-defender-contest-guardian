/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Chart,
  // type ScriptableContext,
  type ChartOptions,
  type ScriptableContext,
} from "chart.js";
import { motion, type Variants } from "framer-motion";
import { Bar } from "react-chartjs-2";

import styles from "./Card4.module.css";
import background from "../../../../../assets/liquidation-journey/bg-illustration-4.webp";
import { formatNumber } from "../../../../../utils/formatNumber.util";
import { Header } from "../Header/Header";
import cardStyles from "../LiquidationJourneyCard.module.css";

import type { LiquidationJourneyData } from "../../../../../hooks/useLiquidationJourneyData";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// --- helpers -------------------------------------------------

const containerVariants = {
  hidden: {
    transition: { duration: 0, staggerChildren: 0 },
  },
  visible: {
    transition: {
      staggerChildren: 0.5,
    },
  },
};

const itemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    transition: { duration: 0 },
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

const formatMonth = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const getMonthRange = (start: Date, end: Date) => {
  const months: string[] = [];
  const current = new Date(start);
  current.setDate(1);

  while (current <= end) {
    months.push(formatMonth(current));
    current.setMonth(current.getMonth() + 1);
  }

  return months;
};

const addMonths = (date: Date, amount: number) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + amount);
  return d;
};

const peakLabelPlugin = {
  id: "peakLabel",
  afterDatasetsDraw(chart: Chart) {
    const { ctx } = chart;
    if (chart.data.datasets.length === 0) return;
    const dataset = chart.data.datasets[0];
    const data = dataset.data as number[];

    const maxValue = Math.max(...data);
    const index = data.indexOf(maxValue);
    if (maxValue === 0) return;

    const meta = chart.getDatasetMeta(0);
    const bar = meta.data[index];
    if (!bar) return;

    const label =
      maxValue < 0.005 ? "<$0.01" : `${formatNumber(maxValue, false, true)}`;

    ctx.save();

    // Bubble
    ctx.fillStyle = "#f5fefd";
    ctx.strokeStyle = "#f5fefd";
    ctx.lineWidth = 1;

    const padding = 12;
    ctx.font = "12px Sora, sans-serif";
    const textWidth = ctx.measureText(label).width;

    const width = textWidth + padding * 2;
    const height = 28;
    const radius = 8;

    const { left, right } = chart.chartArea;
    const idealX = bar.x - width / 2;
    const x = Math.max(left + 4, Math.min(idealX, right - width - 4));
    const y = bar.y - 36;

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle = "#04060c";
    ctx.fillText(label, x + padding, y + 18);

    ctx.restore();
  },
};

export const Card4 = ({
  liquidationJourneyData,
  isActive,
}: {
  liquidationJourneyData: LiquidationJourneyData;
  isActive: boolean;
}) => {
  const monthly = liquidationJourneyData.liquidationsPerMonth;

  const byMonth = new Map(
    monthly.map((m) => [m.month, m.totalLiquidationNotional]),
  );

  const firstMonth =
    monthly.length > 0 ? new Date(`${monthly[0].month}-01`) : new Date();

  const lastMonth =
    monthly.length > 0
      ? new Date(`${monthly[monthly.length - 1].month}-01`)
      : new Date();

  const minStart = addMonths(lastMonth, -9);
  const start = firstMonth > minStart ? minStart : firstMonth;

  const labels = getMonthRange(start, lastMonth);
  const values = labels.map((month) => byMonth.get(month) ?? 0);
  const animatedValues = isActive ? values : values.map(() => 0);

  const data = {
    labels,
    datasets: [
      {
        data: animatedValues,
        backgroundColor: "rgba(255, 255, 255, 0.8)",
        borderRadius: 2,
        barPercentage: 0.95,
        categoryPercentage: 1,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    animation: {
      duration: 1400,
      easing: "easeOutQuart",
      delay(ctx: ScriptableContext<"bar">) {
        if (ctx.type !== "data") return 0;
        return ctx.dataIndex * 40;
      },
    },
    layout: {
      padding: {
        top: 36,
      },
    },
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        yAlign: "bottom",
        xAlign: "center",
        backgroundColor: "#f5fefd",
        titleColor: "#04060c",
        bodyColor: "#04060c",
        padding: 12,
        displayColors: false,
        callbacks: {
          title: (items) => {
            const raw = items[0].label; // "2025-03"
            const date = new Date(`${raw}-01`);

            return date.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            });
          },
          label: (item) => {
            const value = item.raw as number;
            return value < 0.005 ? "<$0.01" : formatNumber(value, false, true);
          },
        },
      },
    },
    scales: {
      y: {
        display: false,
        grid: { display: false },
        border: { display: false },
      },
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: "rgba(255,255,255,0.7)",
          autoSkip: false,
          maxRotation: 0,
          callback: (_: any, index: number) => {
            const current = labels[index];
            if (!current) return "";

            const currentYear = current.slice(0, 4);

            // Only consider labels where the year changes vs previous
            const prev = labels[index - 1];
            const prevYear = prev?.slice(0, 4);

            if (currentYear === prevYear) return "";

            // 🔑 Look ahead 4 bars
            for (let i = 1; i <= 4; i++) {
              const next = labels[index + i];
              if (!next) break;

              const nextYear = next.slice(0, 4);

              // If another year label appears soon, hide this one
              if (nextYear !== currentYear) {
                return "";
              }
            }

            return currentYear;
          },
        },
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate={isActive ? "visible" : "hidden"}
      className={`${cardStyles.container} ${styles.card}`}
    >
      <Header />
      <img
        src={background}
        alt="Background"
        className={cardStyles.backgroundImage}
        style={{ transform: "scaleX(-1)" }}
      />
      <motion.div variants={itemVariants} className={styles.textContainer}>
        <div className={styles.titleContainer}>Your Liquidation Timeline</div>
        <div className={styles.subtitleContainer}>
          Your liquidation history earns you a higher score
        </div>
      </motion.div>
      <div className={styles.chartContainer}>
        {isActive && (
          <Bar data={data} options={options} plugins={[peakLabelPlugin]} />
        )}
      </div>
    </motion.div>
  );
};
