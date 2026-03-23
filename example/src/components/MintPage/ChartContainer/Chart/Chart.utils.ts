export const utcToLocalSeconds = (utcSeconds: number) => {
  const userOffsetMinutes = new Date().getTimezoneOffset();
  const date = new Date(utcSeconds * 1000);
  const localMs = date.getTime() - userOffsetMinutes * 60_000;
  return Math.floor(localMs / 1000);
};

export const chartColors = ({ theme }: { theme: "light" | "dark" }) => {
  return theme === "dark"
    ? {
        text: "#fff",
        grid: "#404147",
      }
    : {
        text: "#404147",
        grid: "#e3d5fd",
      };
};

export function formatChartPrice(price: number): string {
  if (price >= 10000) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  if (price >= 1000) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }
  if (price >= 100) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 10) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  }
  if (price >= 1) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }
  if (price >= 0.01) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 5,
      maximumFractionDigits: 5,
    });
  }
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}

export const getLastNCandles = () => {
  const screenWidth = window.innerWidth;
  if (screenWidth < 420) return 30;
  if (screenWidth < 768) return 50;
  if (screenWidth < 1024) return 75;
  if (screenWidth < 1240) return 50;
  if (screenWidth < 1440) return 75;
  return 100;
};
