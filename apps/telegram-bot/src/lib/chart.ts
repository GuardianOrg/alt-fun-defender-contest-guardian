import type { ApiResult } from "./api.js";
import {
  CHART_EMPTY_STATE_TEXT,
  DEFAULT_LANGUAGE,
  type Language,
  t,
} from "./i18n.js";
import { logger } from "./logger.js";
import type { Env } from "./types.js";

/** Candle row shape served by `GET /api/v1/chart/:address`. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Full chart snapshot returned by the api. */
export interface ChartSnapshot {
  candles: Candle[];
  currentRatio: number;
  currentExchangeRate: number;
}

export type ChartTimeframe = "1d" | "5d" | "1m";

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
}

const buildHeaders = (apiKey: string | undefined): HeadersInit => {
  const headers: Record<string, string> = { accept: "application/json" };
  const normalized = apiKey?.trim();
  if (normalized) headers["x-api-key"] = normalized;
  return headers;
};

const isCandle = (v: unknown): v is Candle => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.time === "number" &&
    typeof o.open === "number" &&
    typeof o.high === "number" &&
    typeof o.low === "number" &&
    typeof o.close === "number"
  );
};

const isChartSnapshot = (v: unknown): v is ChartSnapshot => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.candles) &&
    o.candles.every(isCandle) &&
    typeof o.currentRatio === "number" &&
    typeof o.currentExchangeRate === "number"
  );
};

/**
 * Fetch the canonical chart snapshot the web app uses (`fetchChart` in
 * `apps/web/src/services/api.ts`). `?timeframe=1d` is the /track default
 * per AGENTS.md — 24h of candles, server-picked candle width.
 */
export const fetchChartSnapshot = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  address: string,
  timeframe: ChartTimeframe = "1d",
): Promise<ApiResult<ChartSnapshot>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(
      `${env.API_BASE_URL}/api/v1/chart/${address}?timeframe=${timeframe}`,
      {
        headers: buildHeaders(env.API_KEY),
        signal: controller.signal,
      },
    );
  } catch {
    return { ok: false, kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 400) return { ok: false, kind: "invalid_address" };
  if (res.status === 404) return { ok: false, kind: "not_found" };
  if (res.status === 503 || res.status >= 500)
    return { ok: false, kind: "unavailable" };
  if (!res.ok) return { ok: false, kind: "unknown" };
  let body: ApiEnvelope<unknown>;
  try {
    body = (await res.json()) as ApiEnvelope<unknown>;
  } catch {
    return { ok: false, kind: "unknown" };
  }
  if (!body || body.data === undefined) return { ok: false, kind: "unknown" };
  if (!isChartSnapshot(body.data)) return { ok: false, kind: "unknown" };
  return { ok: true, data: body.data };
};

export interface ChartSvgOptions {
  /** Image pixel width. Default 800. */
  width?: number;
  /** Image pixel height. Default 400. */
  height?: number;
  /** Token display name shown as the chart title. */
  title?: string;
  /** Optional sub-line under the title (e.g. "24h"). */
  subtitle?: string;
  /** Locale for the empty-state placeholder. Defaults to English. */
  lang?: Language;
}

const BG = "#0e1116";
const GRID = "#1f242b";
const TEXT = "#c8ced6";
const UP = "#22c55e";
const DOWN = "#ef4444";
const FLAT = "#9ca3af";

const PAD_LEFT = 56;
const PAD_RIGHT = 16;
const PAD_TOP = 44;
const PAD_BOTTOM = 28;

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Format a price for the Y-axis labels. Picks a precision that keeps
 * very small curve prices (sub-cent typical for fresh tokens) readable
 * without leaving trailing-zero noise on graduated tokens at higher
 * prices.
 */
const formatPrice = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toExponential(2);
};

/**
 * Build a static candlestick SVG for the /track chart image. Pure —
 * takes only the candle array + sizing options. Returns an SVG string
 * ready to feed into resvg for PNG conversion.
 *
 * Layout notes:
 * - Candle bodies stay at least 1px tall so doji candles still render.
 * - Wicks are drawn at the candle's horizontal centre with a 1px stroke.
 * - When all closes equal opens we paint the body in the flat colour to
 *   match how lightweight-charts renders unchanged candles on the web.
 */
export const buildChartSvg = (
  candles: Candle[],
  opts: ChartSvgOptions = {},
): string => {
  const width = opts.width ?? 800;
  const height = opts.height ?? 400;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  const title = opts.title ?? "";
  const subtitle = opts.subtitle ?? "";
  const titleSvg = title
    ? `<text x="${PAD_LEFT}" y="22" fill="${TEXT}" font-family="-apple-system, system-ui, sans-serif" font-size="16" font-weight="600">${escapeXml(title)}</text>`
    : "";
  const subtitleSvg = subtitle
    ? `<text x="${width - PAD_RIGHT}" y="22" fill="${TEXT}" font-family="-apple-system, system-ui, sans-serif" font-size="12" text-anchor="end">${escapeXml(subtitle)}</text>`
    : "";

  if (candles.length === 0) {
    const emptyText = escapeXml(
      t(CHART_EMPTY_STATE_TEXT, opts.lang ?? DEFAULT_LANGUAGE),
    );
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
      `<rect width="${width}" height="${height}" fill="${BG}"/>`,
      titleSvg,
      subtitleSvg,
      `<text x="${width / 2}" y="${height / 2}" fill="${TEXT}" font-family="-apple-system, system-ui, sans-serif" font-size="14" text-anchor="middle">${emptyText}</text>`,
      `</svg>`,
    ].join("");
  }

  let min = candles[0]!.low;
  let max = candles[0]!.high;
  for (const c of candles) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  // Avoid a zero-height range that would divide-by-zero on a flat
  // series — pad symmetrically around the value so the flat line lands
  // mid-plot instead of pinned to the edge.
  if (max - min <= 0) {
    const pad = Math.max(Math.abs(max) * 0.05, 1e-12);
    min -= pad;
    max += pad;
  } else {
    const span = max - min;
    min -= span * 0.05;
    max += span * 0.05;
  }
  const range = max - min;

  const yFor = (price: number): number =>
    PAD_TOP + plotH - ((price - min) / range) * plotH;

  // Candle column width — minimum 1px so we don't lose narrow candles on
  // very wide series; wick stays 1px regardless.
  const colW = Math.max(plotW / candles.length, 1);
  const bodyW = Math.max(colW * 0.7, 1);

  const candleEls: string[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const cx = PAD_LEFT + colW * (i + 0.5);
    const yHigh = yFor(c.high);
    const yLow = yFor(c.low);
    const yOpen = yFor(c.open);
    const yClose = yFor(c.close);
    const top = Math.min(yOpen, yClose);
    const h = Math.max(Math.abs(yClose - yOpen), 1);
    const colour =
      c.close > c.open ? UP : c.close < c.open ? DOWN : FLAT;
    candleEls.push(
      `<line x1="${cx.toFixed(2)}" x2="${cx.toFixed(2)}" y1="${yHigh.toFixed(2)}" y2="${yLow.toFixed(2)}" stroke="${colour}" stroke-width="1"/>`,
    );
    candleEls.push(
      `<rect x="${(cx - bodyW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bodyW.toFixed(2)}" height="${h.toFixed(2)}" fill="${colour}"/>`,
    );
  }

  // 4 horizontal gridlines + price labels.
  const gridEls: string[] = [];
  const labelEls: string[] = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const y = PAD_TOP + plotH * t;
    const price = max - range * t;
    gridEls.push(
      `<line x1="${PAD_LEFT}" x2="${width - PAD_RIGHT}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${GRID}" stroke-width="1"/>`,
    );
    labelEls.push(
      `<text x="${PAD_LEFT - 6}" y="${(y + 4).toFixed(2)}" fill="${TEXT}" font-family="-apple-system, system-ui, sans-serif" font-size="10" text-anchor="end">$${formatPrice(price)}</text>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="${BG}"/>`,
    titleSvg,
    subtitleSvg,
    gridEls.join(""),
    candleEls.join(""),
    labelEls.join(""),
    `</svg>`,
  ].join("");
};

/**
 * Render the chart SVG to a PNG byte array. The wasm renderer lives in
 * `chart-wasm.ts` and is dynamically imported so vitest (which doesn't
 * resolve the bundled `.wasm` import) never has to load it. The caller
 * is expected to wrap this in a try/catch and degrade to "no image" on
 * any failure — chart rendering is best-effort, not a /track blocker.
 */
export const renderChartPng = async (svg: string): Promise<Uint8Array> => {
  const mod = await import("./chart-wasm.js");
  return mod.svgToPng(svg);
};

/**
 * Composite helper: fetch + build SVG + render PNG. Returns `null` on
 * any failure so callers can ignore the image and continue rendering
 * the text card.
 */
export const buildTrackChartPng = async (
  env: Pick<Env, "API_BASE_URL" | "API_KEY">,
  address: string,
  title: string,
  lang: Language = DEFAULT_LANGUAGE,
): Promise<Uint8Array | null> => {
  try {
    const snap = await fetchChartSnapshot(env, address, "1d");
    if (!snap.ok) return null;
    if (snap.data.candles.length === 0) return null;
    const svg = buildChartSvg(snap.data.candles, {
      title,
      subtitle: "24h",
      lang,
    });
    return await renderChartPng(svg);
  } catch (err) {
    logger.warn("chart render failed", { address, err: String(err) });
    return null;
  }
};
