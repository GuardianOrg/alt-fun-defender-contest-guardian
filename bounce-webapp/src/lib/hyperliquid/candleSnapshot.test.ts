import { describe, expect, it, vi } from "vitest";

import { fetchHyperliquidCandleSnapshot } from "./candleSnapshot";

describe("fetchHyperliquidCandleSnapshot", () => {
  it("throws when response is not ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: vi.fn(),
    });

    await expect(
      fetchHyperliquidCandleSnapshot(
        {
          coin: "BTC",
          interval: "1h",
          startTimeMs: 0,
          endTimeMs: 1,
        },
        fetchImpl,
      ),
    ).rejects.toThrow("Hyperliquid candleSnapshot failed: 502 Bad Gateway");
  });

  it("throws when body is not an array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ error: "nope" }),
    });

    await expect(
      fetchHyperliquidCandleSnapshot(
        {
          coin: "ETH",
          interval: "1m",
          startTimeMs: 0,
          endTimeMs: 1,
        },
        fetchImpl,
      ),
    ).rejects.toThrow("response is not an array");
  });

  it("posts candleSnapshot with correct JSON body", async () => {
    const payload = [{ t: 1000, o: "1", h: "1", l: "1", c: "1" }];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    });

    const rows = await fetchHyperliquidCandleSnapshot(
      {
        coin: "BTC",
        interval: "4h",
        startTimeMs: 10,
        endTimeMs: 99,
      },
      fetchImpl,
    );

    expect(rows).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.hyperliquid.xyz/info",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "candleSnapshot",
          req: {
            coin: "BTC",
            interval: "4h",
            startTime: 10,
            endTime: 99,
          },
        }),
      }),
    );
  });
});
