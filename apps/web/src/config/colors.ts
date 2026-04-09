export const COLORS = {
  mint: "#4de8b4",
  red: "#f05050",
  amber: "#f0b429",
  text: "#eafaf4",
} as const;

export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
