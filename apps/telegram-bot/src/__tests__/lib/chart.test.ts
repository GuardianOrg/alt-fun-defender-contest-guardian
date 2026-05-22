import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildChartSvg,
  buildTrackChartPng,
  fetchChartSnapshot,
  type Candle,
} from "../../lib/chart.js";

const API_BASE = "https://api.test.local";
const env = { API_BASE_URL: API_BASE, API_KEY: "test-api-key" };
const ADDR = "0x1111111111111111111111111111111111111111";

const candle = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle => ({ time, open, high, low, close });

describe("buildChartSvg", () => {
  it("produces a valid SVG root element with the given size", () => {
    const svg = buildChartSvg([candle(1, 1, 2, 0.5, 1.5)], {
      width: 600,
      height: 300,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 600 300"`);
    expect(svg).toContain(`width="600"`);
    expect(svg).toContain(`height="300"`);
    expect(svg).toContain("</svg>");
  });

  it("renders one candle per data point (rect bodies)", () => {
    const candles = Array.from({ length: 5 }, (_, i) =>
      candle(i, 1, 1.2, 0.8, 1.1),
    );
    const svg = buildChartSvg(candles);
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    // 1 background rect + 1 body rect per candle.
    expect(rectCount).toBe(1 + 5);
  });

  it("colours up candles green and down candles red", () => {
    const svg = buildChartSvg(
      [candle(1, 1, 2, 1, 1.5), candle(2, 2, 2, 1, 1.1)],
      { width: 400, height: 200 },
    );
    expect(svg).toContain("#22c55e");
    expect(svg).toContain("#ef4444");
  });

  it("renders an explanatory empty-state when there are no candles", () => {
    const svg = buildChartSvg([], { title: "Foo" });
    expect(svg).toContain("No price data yet");
    expect(svg).toContain("Foo");
  });

  it("localises the empty-state text when lang is provided", () => {
    const svg = buildChartSvg([], { title: "Foo", lang: "SimplifiedChinese" });
    expect(svg).toContain("暂无价格数据");
    expect(svg).not.toContain("No price data yet");
  });

  it("escapes XML metacharacters in the title to avoid breaking parsing", () => {
    const svg = buildChartSvg([candle(1, 1, 2, 0.5, 1.5)], {
      title: '<script>alert("x")</script>',
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("pads a flat price series so it renders mid-plot instead of divide-by-zero", () => {
    const flat = Array.from({ length: 3 }, (_, i) => candle(i, 1, 1, 1, 1));
    const svg = buildChartSvg(flat);
    // Y-axis labels should still surface (price formatter applied) and no
    // `NaN` should leak into rendered coordinates.
    expect(svg).not.toContain("NaN");
    expect(svg).toMatch(/\$\d/);
  });
});

describe("fetchChartSnapshot", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns parsed candles + ratios on a 200", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            candles: [candle(1, 1, 2, 0.5, 1.5)],
            currentRatio: 0.5,
            currentExchangeRate: 2,
          },
          error: null,
        }),
        { status: 200 },
      ),
    );
    const result = await fetchChartSnapshot(env, ADDR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candles).toHaveLength(1);
    expect(result.data.currentRatio).toBe(0.5);
    expect(result.data.currentExchangeRate).toBe(2);
  });

  it("defaults to timeframe=1d for the /track image", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: { candles: [], currentRatio: 0, currentExchangeRate: 0 },
          error: null,
        }),
        { status: 200 },
      ),
    );
    await fetchChartSnapshot(env, ADDR);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("timeframe=1d");
  });

  it("maps 503 to `unavailable`", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 503 }));
    const result = await fetchChartSnapshot(env, ADDR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unavailable");
  });

  it("maps 404 to `not_found`", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 404 }));
    const result = await fetchChartSnapshot(env, ADDR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_found");
  });

  it("rejects a malformed payload as `unknown`", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: { wrong: "shape" },
          error: null,
        }),
        {
          status: 200,
        },
      ),
    );
    const result = await fetchChartSnapshot(env, ADDR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unknown");
  });
});

describe("buildTrackChartPng", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns null when the chart endpoint is unavailable", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 503 }));
    const png = await buildTrackChartPng(env, ADDR, "Foo");
    expect(png).toBeNull();
  });

  it("returns null when the candle array is empty", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: { candles: [], currentRatio: 0, currentExchangeRate: 0 },
          error: null,
        }),
        { status: 200 },
      ),
    );
    const png = await buildTrackChartPng(env, ADDR, "Foo");
    expect(png).toBeNull();
  });

  it("returns null (instead of throwing) when the wasm renderer cannot load", async () => {
    // In the vitest node env, `import("./chart-wasm.js")` cannot resolve
    // the bundled `.wasm` import. The helper must catch and return null
    // so the /track text reply still goes out — the renderer is
    // best-effort, not a blocker.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            candles: [candle(1, 1, 2, 0.5, 1.5)],
            currentRatio: 0.5,
            currentExchangeRate: 2,
          },
          error: null,
        }),
        { status: 200 },
      ),
    );
    const png = await buildTrackChartPng(env, ADDR, "Foo");
    expect(png).toBeNull();
  });
});
