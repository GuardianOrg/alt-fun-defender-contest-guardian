import { describe, expect, it, vi } from "vitest";

import { createHyperliquidDatafeed } from "./createHyperliquidDatafeed";

import type { LibrarySymbolInfo } from "../../../../public/charting_library/datafeed-api";
import type { ResolutionString } from "../../../types/chartingLibrary";


const btcSymbol = {
  name: "BTC",
  ticker: "BTC",
} as LibrarySymbolInfo;

describe("createHyperliquidDatafeed", () => {
  it("getBars calls onError when fetch fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const { datafeed, dispose } = createHyperliquidDatafeed({ fetchImpl });

    const onResult = vi.fn();
    const onError = vi.fn();

    datafeed.getBars(
      btcSymbol,
      "60" as ResolutionString,
      {
        from: 1,
        to: 3,
        countBack: 10,
        firstDataRequest: true,
      },
      onResult,
      onError,
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("network down"));
    expect(onResult).not.toHaveBeenCalled();
    dispose();
  });

  it("getBars maps snapshot rows to TradingView bars in ms time", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        { t: 3000, o: "2", h: "3", l: "1", c: "2.5" },
        { t: 1000, o: "1", h: "1", l: "1", c: "1" },
      ]),
    });

    const { datafeed, dispose } = createHyperliquidDatafeed({ fetchImpl });
    const onResult = vi.fn();
    const onError = vi.fn();

    datafeed.getBars(
      btcSymbol,
      "1D" as ResolutionString,
      {
        from: 0,
        to: 10,
        countBack: 5,
        firstDataRequest: true,
      },
      onResult,
      onError,
    );

    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();

    const [bars] = onResult.mock.calls[0]!;
    expect(bars.map((b: { time: number }) => b.time)).toEqual([1000, 3000]);
    expect(bars[1].close).toBe(2.5);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        body: expect.stringContaining('"interval":"1d"'),
      }),
    );

    dispose();
  });

  it("getBars calls onError for unsupported resolution", () => {
    const { datafeed, dispose } = createHyperliquidDatafeed();
    const onResult = vi.fn();
    const onError = vi.fn();

    datafeed.getBars(
      btcSymbol,
      "333" as ResolutionString,
      {
        from: 0,
        to: 1,
        countBack: 1,
        firstDataRequest: true,
      },
      onResult,
      onError,
    );

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Unsupported"));
    expect(onResult).not.toHaveBeenCalled();
    dispose();
  });
});
